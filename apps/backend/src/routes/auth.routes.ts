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
