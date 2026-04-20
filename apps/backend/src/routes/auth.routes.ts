import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../services/AuthService.js";
import { requireAuth, requireAdmin, requireSuperAdmin } from "../middleware/requireAuth.js";
import type { Database } from "../config/database.js";
import { users } from "../models/index.js";
import { eq } from "drizzle-orm";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export function authRoutes(app: FastifyInstance, authService: AuthService, db: Database) {
  app.post("/api/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await authService.login(body.email, body.password, request.headers["user-agent"]);
    return reply.send(result);
  });

  app.post("/api/auth/refresh", async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    const result = await authService.refresh(body.refreshToken);
    return reply.send(result);
  });

  app.post(
    "/api/auth/logout",
    { preHandler: requireAuth(authService) },
    async (request, reply) => {
      const body = refreshSchema.parse(request.body);
      await authService.logout(body.refreshToken);
      return reply.send({ success: true });
    }
  );

  app.get(
    "/api/auth/me",
    { preHandler: requireAuth(authService) },
    async (request, reply) => {
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          role: users.role,
          team: users.team,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(eq(users.id, request.user.sub))
        .limit(1);

      if (!user) {
        return reply.status(404).send({ error: "Not found", message: "User not found" });
      }
      return reply.send({ user });
    }
  );

  // ─── Browser-based login for desktop app ───
  // In-memory store for pending login codes (code → token)
  const pendingLogins = new Map<string, { token: string | null; user: unknown; expiresAt: number }>();

  // Desktop app calls this to create a login code, then opens browser
  app.post("/api/auth/device-code", async (_request, reply) => {
    const code = Math.random().toString(36).slice(2, 10).toUpperCase();
    pendingLogins.set(code, { token: null, user: null, expiresAt: Date.now() + 5 * 60 * 1000 });
    // Clean up expired codes
    for (const [k, v] of pendingLogins) { if (v.expiresAt < Date.now()) pendingLogins.delete(k); }
    return reply.send({ code, expiresIn: 300 });
  });

  // Browser page calls this after user logs in — stores the token
  app.post("/api/auth/device-code/complete", async (request, reply) => {
    const body = z.object({ code: z.string(), platformToken: z.string() }).parse(request.body);
    const pending = pendingLogins.get(body.code);
    if (!pending || pending.expiresAt < Date.now()) {
      return reply.status(400).send({ error: "Invalid or expired code" });
    }
    try {
      const payload = await authService.verifyPlatformToken(body.platformToken);
      const [user] = await db
        .select({ id: users.id, email: users.email, fullName: users.fullName, role: users.role, team: users.team })
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);
      if (!user) return reply.status(404).send({ error: "User not found" });
      const localToken = authService.generateAccessTokenForUser(user);
      pending.token = localToken;
      pending.user = user;
      return reply.send({ ok: true });
    } catch {
      return reply.status(401).send({ error: "Invalid platform token" });
    }
  });

  // Desktop app polls this until token is ready
  app.get("/api/auth/device-code/poll", async (request, reply) => {
    const { code } = z.object({ code: z.string() }).parse(request.query);
    const pending = pendingLogins.get(code);
    if (!pending || pending.expiresAt < Date.now()) {
      pendingLogins.delete(code);
      return reply.send({ status: "expired" });
    }
    if (pending.token) {
      pendingLogins.delete(code);
      return reply.send({ status: "complete", accessToken: pending.token, user: pending.user });
    }
    return reply.send({ status: "pending" });
  });

  // Proxy login to staging backend (avoids CORS issues from browser)
  app.post("/api/auth/platform-proxy-login", async (request, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(request.body);
    try {
      const resp = await fetch("https://staging-backend.ailancers.com/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) {
        return reply.status(resp.status).send(data);
      }
      return reply.send(data);
    } catch (err) {
      return reply.status(502).send({ error: "Failed to reach Ailancers platform" });
    }
  });

  // Serve the browser login page
  app.get("/auth-bridge", async (request, reply) => {
    const { code } = request.query as { code?: string };
    if (!code) return reply.status(400).send("Missing code parameter");

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ailancers — Connect Desktop Tracker</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f0f23;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{max-width:380px;width:100%;background:#1c1e2e;border-radius:12px;padding:32px;border:1px solid #2a2d3e}
h2{color:#818cf8;margin-bottom:8px;font-size:20px}
p{color:#94a3b8;font-size:13px;margin-bottom:20px}
label{display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase}
input{width:100%;padding:10px 14px;background:#0f0f23;border:1px solid #334155;border-radius:8px;color:#e2e8f0;font-size:14px;margin-bottom:16px;outline:none}
input:focus{border-color:#818cf8}
button{width:100%;padding:12px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#4f46e5}
button:disabled{background:#475569;cursor:not-allowed}
.error{color:#f87171;font-size:12px;margin-top:8px}
.success{color:#22c55e;font-size:16px;text-align:center;margin-top:16px}
.code-badge{display:inline-block;background:#818cf820;color:#818cf8;padding:2px 8px;border-radius:4px;font-family:monospace;font-size:12px}
</style></head>
<body>
<div class="card">
<h2>Connect Desktop Tracker</h2>
<p>Sign in with your Ailancers account to connect the desktop tracker. Code: <span class="code-badge">${code}</span></p>
<form id="form">
<label>Email</label>
<input type="email" id="email" placeholder="you@company.com" required autofocus>
<label>Password</label>
<input type="password" id="password" placeholder="Password" required>
<button type="submit" id="btn">Connect</button>
</form>
<div class="error" id="err"></div>
<div class="success" id="ok" style="display:none">Connected! You can close this tab.</div>
</div>
<script>
const code="${code}";
document.getElementById("form").addEventListener("submit",async e=>{
e.preventDefault();
const btn=document.getElementById("btn");
const err=document.getElementById("err");
err.textContent="";btn.disabled=true;btn.textContent="Connecting...";
try{
const r=await fetch("/api/auth/platform-proxy-login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:document.getElementById("email").value,password:document.getElementById("password").value})});
const d=await r.json();
if(!r.ok)throw new Error(d.detail||d.message||"Login failed");
const r2=await fetch("/api/auth/device-code/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,platformToken:d.token})});
if(!r2.ok){const e2=await r2.json();throw new Error(e2.error||"Failed");}
document.getElementById("form").style.display="none";
document.getElementById("ok").style.display="block";
}catch(ex){err.textContent=ex.message;}
finally{btn.disabled=false;btn.textContent="Connect";}
});
</script>
</body></html>`;

    return reply.type("text/html").send(html);
  });

  // Platform token login — for dashboard auto-login (any Ailancers user)
  app.post("/api/auth/platform-login", async (request, reply) => {
    const body = z.object({ platformToken: z.string().min(1) }).parse(request.body);

    try {
      const payload = await authService.verifyPlatformToken(body.platformToken);
      const [user] = await db
        .select({ id: users.id, email: users.email, fullName: users.fullName, role: users.role, team: users.team })
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);

      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      // Generate a local JWT for the dashboard
      const localToken = authService.generateAccessTokenForUser(user);

      return reply.send({
        accessToken: localToken,
        user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, team: user.team },
      });
    } catch {
      return reply.status(401).send({ error: "Invalid platform token" });
    }
  });

  // Admin: update user role
  app.put("/api/admin/users/:userId/role", { preHandler: requireAdmin(authService) }, async (request, reply) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      role: z.enum(["employee", "developer", "manager", "admin", "super_admin"]),
    }).parse(request.body);

    // Only super_admin can promote to admin/super_admin
    if ((body.role === "admin" || body.role === "super_admin") && request.user.role !== "super_admin") {
      return reply.status(403).send({ error: "Only super admins can assign admin roles" });
    }

    await db
      .update(users)
      .set({ role: body.role, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return reply.send({ ok: true });
  });
}
