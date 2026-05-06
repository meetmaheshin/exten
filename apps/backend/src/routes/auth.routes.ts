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
          // Extension reads this on session start to skip captureNow()
          // entirely when the super-admin has disabled screenshots for
          // this user. Saves bandwidth + battery vs. capture-then-403.
          screenshotsDisabled: users.screenshotsDisabled,
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
  const pendingLogins = new Map<string, { token: string | null; platformToken: string | null; user: unknown; expiresAt: number }>();

  // Desktop app calls this to create a login code, then opens browser
  app.post("/api/auth/device-code", async (_request, reply) => {
    const code = Math.random().toString(36).slice(2, 10).toUpperCase();
    pendingLogins.set(code, { token: null, platformToken: null, user: null, expiresAt: Date.now() + 5 * 60 * 1000 });
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
      pending.platformToken = body.platformToken;
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
      return reply.send({ status: "complete", accessToken: pending.token, platformToken: pending.platformToken, user: pending.user });
    }
    return reply.send({ status: "pending" });
  });

  // Google OAuth callback — completes device-code flow after Google login
  app.get("/api/auth/google/callback", async (request, reply) => {
    const { token, device_code } = request.query as { token?: string; device_code?: string };
    if (!token || !device_code) {
      return reply.status(400).send("Missing token or device_code");
    }

    const pending = pendingLogins.get(device_code);
    if (!pending || pending.expiresAt < Date.now()) {
      return reply.type("text/html").send("<h2>Login expired. Please try again from the app.</h2>");
    }

    try {
      const payload = await authService.verifyPlatformToken(token);
      const [user] = await db
        .select({ id: users.id, email: users.email, fullName: users.fullName, role: users.role, team: users.team })
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);
      if (!user) return reply.type("text/html").send("<h2>User not found.</h2>");
      const localToken = authService.generateAccessTokenForUser(user);
      pending.token = localToken;
      pending.user = user;
      return reply.type("text/html").send(`<html><body style="background:#0f0f23;color:#22c55e;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;font-size:20px"><div style="text-align:center">Connected! You can close this tab.</div></body></html>`);
    } catch {
      return reply.type("text/html").send("<h2>Authentication failed. Please try again.</h2>");
    }
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
<title>Ailancers — Connect Tracker</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f0f23;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{max-width:400px;width:100%;background:#1c1e2e;border-radius:12px;padding:32px;border:1px solid #2a2d3e}
h2{color:#818cf8;margin-bottom:8px;font-size:20px}
p{color:#94a3b8;font-size:13px;margin-bottom:20px}
label{display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase}
input{width:100%;padding:10px 14px;background:#0f0f23;border:1px solid #334155;border-radius:8px;color:#e2e8f0;font-size:14px;margin-bottom:16px;outline:none}
input:focus{border-color:#818cf8}
.btn{width:100%;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:8px}
.btn-primary{background:#6366f1;color:#fff}
.btn-primary:hover{background:#4f46e5}
.btn-google{background:#fff;color:#333;border:1px solid #ddd}
.btn-google:hover{background:#f5f5f5}
.btn:disabled{background:#475569;cursor:not-allowed;color:#94a3b8}
.divider{display:flex;align-items:center;gap:10px;margin:16px 0;color:#475569;font-size:12px}
.divider::before,.divider::after{content:"";flex:1;height:1px;background:#334155}
.error{color:#f87171;font-size:12px;margin-top:8px}
.success{color:#22c55e;font-size:16px;text-align:center;padding:20px 0}
.auto-msg{text-align:center;color:#818cf8;font-size:14px;padding:20px 0}
.code-badge{display:inline-block;background:#818cf820;color:#818cf8;padding:2px 8px;border-radius:4px;font-family:monospace;font-size:12px}
</style></head>
<body>
<div class="card">
<h2>Connect Tracker</h2>
<p id="subtitle">Connecting to your Ailancers account... Code: <span class="code-badge">${code}</span></p>

<!-- Auto-login status -->
<div class="auto-msg" id="autoMsg" style="display:none">Checking existing session...</div>

<!-- Google OAuth -->
<button class="btn btn-google" id="googleBtn" onclick="loginGoogle()" style="display:none">
  <svg width="18" height="18" viewBox="0 0 48 48" style="vertical-align:middle;margin-right:8px"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
  Continue with Google
</button>

<div class="divider" id="divider" style="display:none"><span>or sign in with email</span></div>

<!-- Email/password form -->
<form id="form" style="display:none">
<label>Email</label>
<input type="email" id="email" placeholder="you@company.com" required>
<label>Password</label>
<input type="password" id="password" placeholder="Password" required>
<button type="submit" class="btn btn-primary" id="btn">Connect</button>
</form>

<div class="error" id="err"></div>
<div class="success" id="ok" style="display:none">Connected! You can close this tab.</div>
</div>
<script>
const code="${code}";

// Try auto-login from shared cookie first
async function tryAutoLogin(){
  const autoMsg=document.getElementById("autoMsg");
  autoMsg.style.display="block";

  // Check for ailance_token cookie (set by ailancers.com)
  const cookies=document.cookie.split(";").map(c=>c.trim());
  const tokenCookie=cookies.find(c=>c.startsWith("ailance_token="));

  if(tokenCookie){
    const token=tokenCookie.split("=").slice(1).join("=");
    if(token){
      autoMsg.textContent="Found existing session, connecting...";
      try{
        const r=await fetch("/api/auth/device-code/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,platformToken:token})});
        if(r.ok){
          showSuccess();
          return;
        }
      }catch{}
    }
  }

  // Also check localStorage (some Ailancers pages store here)
  try{
    const lsToken=localStorage.getItem("ailance_token");
    if(lsToken){
      autoMsg.textContent="Found saved session, connecting...";
      try{
        const r=await fetch("/api/auth/device-code/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,platformToken:lsToken})});
        if(r.ok){
          showSuccess();
          return;
        }
      }catch{}
    }
  }catch{}

  // No auto-login possible — show login form
  autoMsg.style.display="none";
  document.getElementById("subtitle").textContent="Sign in with your Ailancers account. Code: ${code}";
  document.getElementById("googleBtn").style.display="block";
  document.getElementById("divider").style.display="flex";
  document.getElementById("form").style.display="block";
}

function showSuccess(){
  document.getElementById("autoMsg").style.display="none";
  document.getElementById("form").style.display="none";
  document.getElementById("googleBtn").style.display="none";
  document.getElementById("divider").style.display="none";
  document.getElementById("ok").style.display="block";
  document.getElementById("subtitle").textContent="Connected successfully!";
}

// Google OAuth
function loginGoogle(){
  const redirect=encodeURIComponent(window.location.origin+"/api/auth/google/callback?device_code="+code);
  window.location.href="https://staging-backend.ailancers.com/api/v1/auth/google/login?redirect_uri="+redirect;
}

// Email/password
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
    showSuccess();
  }catch(ex){err.textContent=ex.message;}
  finally{btn.disabled=false;btn.textContent="Connect";}
});

// Start
tryAutoLogin();
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

  // Admin: update user employment status
  app.put("/api/admin/users/:userId/employment-status", { preHandler: requireAdmin(authService) }, async (request, reply) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      employmentStatus: z.enum(["active", "on_leave", "notice", "resigned", "maternity"]),
    }).parse(request.body);

    await db
      .update(users)
      .set({ employmentStatus: body.employmentStatus, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return reply.send({ ok: true });
  });

  // Super-admin: toggle screenshot capture for a specific user.
  // When `screenshotsDisabled = true` the upload route 403s and the
  // extension skips captureNow() entirely. Gated to super_admin only —
  // disabling tracking on a teammate is a privacy-affecting action that
  // shouldn't be available to regular admins.
  app.put("/api/admin/users/:userId/screenshots", { preHandler: requireSuperAdmin(authService) }, async (request, reply) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      screenshotsDisabled: z.boolean(),
    }).parse(request.body);

    await db
      .update(users)
      .set({ screenshotsDisabled: body.screenshotsDisabled, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return reply.send({ ok: true, screenshotsDisabled: body.screenshotsDisabled });
  });
}
