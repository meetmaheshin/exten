import type { FastifyRequest, FastifyReply } from "fastify";
import type { AuthService, JwtPayload } from "../services/AuthService.js";

declare module "fastify" {
  interface FastifyRequest {
    user: JwtPayload;
  }
}

export function requireAuth(authService: AuthService) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Unauthorized", message: "Missing or invalid Authorization header" });
    }

    const token = authHeader.slice(7);

    // Try local JWT first, then fall back to platform token verification
    try {
      request.user = authService.verifyAccessToken(token);
    } catch {
      try {
        request.user = await authService.verifyPlatformToken(token);
      } catch {
        return reply.status(401).send({ error: "Unauthorized", message: "Invalid or expired token" });
      }
    }
  };
}

export function requireAdmin(authService: AuthService) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(authService)(request, reply);
    if (reply.sent) return;

    if (request.user.role !== "admin" && request.user.role !== "super_admin") {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required" });
    }
  };
}
