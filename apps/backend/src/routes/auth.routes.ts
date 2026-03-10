import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../services/AuthService.js";
import { requireAuth } from "../middleware/requireAuth.js";
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
}
