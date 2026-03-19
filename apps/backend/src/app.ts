import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Env } from "./config/env.js";
import type { Database } from "./config/database.js";
import { AuthService } from "./services/AuthService.js";
import { AIService } from "./services/AIService.js";
import { authRoutes } from "./routes/auth.routes.js";
import { chatRoutes } from "./routes/chat.routes.js";
import { chatWsRoute } from "./routes/chat.ws.js";
import { telemetryRoutes } from "./routes/telemetry.routes.js";
import { screenshotRoutes } from "./routes/screenshot.routes.js";
import { activityRoutes } from "./routes/activity.routes.js";
import { AppError } from "./utils/errors.js";
import { ZodError } from "zod";

export async function buildApp(env: Env, db: Database) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
    },
  });

  // Plugins
  await app.register(cors, {
    origin: env.CORS_ORIGINS.split(",").map((s) => s.trim()),
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  await app.register(websocket);

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "Validation Error",
        message: error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "),
        statusCode: 400,
      });
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.name,
        message: error.message,
        statusCode: error.statusCode,
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      error: "Internal Server Error",
      message: env.NODE_ENV === "production" ? "An unexpected error occurred" : (error instanceof Error ? error.message : "Unknown error"),
      statusCode: 500,
    });
  });

  // Health check
  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  // Serve dashboard static files if built
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dashboardPath = join(__dirname, "dashboard-dist");
  if (existsSync(dashboardPath)) {
    await app.register(staticFiles, {
      root: dashboardPath,
      prefix: "/dashboard/",
      decorateReply: false,
      index: "index.html",
      wildcard: false,
    });
    // Redirect /dashboard → /dashboard/
    app.get("/dashboard", async (_req, reply) => reply.redirect("/dashboard/"));
    // Serve index.html for all dashboard sub-routes (client-side routing)
    app.get("/dashboard/*", async (_req, reply) => {
      const indexPath = join(dashboardPath, "index.html");
      return reply.type("text/html").send(await import("fs").then(fs => fs.promises.readFile(indexPath)));
    });
  }

  // Services
  const authService = new AuthService(db, env);
  const aiService = new AIService(env);

  // Model discovery endpoint — includes recommended defaults per mode
  app.get("/api/models", async () => ({
    models: aiService.getAvailableModels(),
    defaults: aiService.getDefaultModels(),
  }));

  // Routes
  authRoutes(app, authService, db);
  chatRoutes(app, authService, db);
  chatWsRoute(app, authService, aiService, db);
  telemetryRoutes(app, authService, db);
  screenshotRoutes(app, authService, db, env);
  activityRoutes(app, authService, db);

  return app;
}
