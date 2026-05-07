import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Env } from "./config/env.js";
import type { Database } from "./config/database.js";
import { AuthService } from "./services/AuthService.js";
import { AIService } from "./services/AIService.js";
import { BillingReporter } from "./services/BillingReporter.js";
import { HourlyTrackerReporter } from "./services/HourlyTrackerReporter.js";
import { FigmaService } from "./services/FigmaService.js";
import { eq, and, desc, isNull, like, gte } from "drizzle-orm";
import { activitySessions } from "./models/index.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { authRoutes } from "./routes/auth.routes.js";
import { chatRoutes } from "./routes/chat.routes.js";
import { chatWsRoute } from "./routes/chat.ws.js";
import { telemetryRoutes } from "./routes/telemetry.routes.js";
import { screenshotRoutes } from "./routes/screenshot.routes.js";
import { activityRoutes } from "./routes/activity.routes.js";
import { externalProjectsRoutes } from "./routes/externalProjects.routes.js";
import { billingRoutes } from "./routes/billing.routes.js";
import { trackerRoutes } from "./routes/tracker.routes.js";
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
    max: 500,
    timeWindow: "1 minute",
    allowList: (req) => {
      // Don't rate limit screenshot image serving or static dashboard files
      const url = req.url || "";
      return url.includes("/image?token=") || url.startsWith("/dashboard/");
    },
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

    // Log every unhandled error with the request context so production logs
    // tell us which endpoint blew up — not just the stack trace.
    app.log.error({
      err: error,
      method: request.method,
      url: request.url,
      userId: request.user?.sub,
    }, `Unhandled error on ${request.method} ${request.url}: ${error instanceof Error ? error.message : String(error)}`);
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
    // Serve favicon from dashboard dist
    app.get("/favicon.ico", async (_req, reply) => {
      const { readFile } = await import("fs/promises");
      const { existsSync: exists } = await import("fs");
      const faviconPath = join(dashboardPath, "favicon.ico");
      if (exists(faviconPath)) {
        const content = await readFile(faviconPath);
        return reply.type("image/x-icon").header("Cache-Control", "public, max-age=86400").send(content);
      }
      return reply.status(204).send();
    });
    // Redirect / and /dashboard → /dashboard/
    app.get("/", async (_req, reply) => reply.redirect("/dashboard/"));
    app.get("/dashboard", async (_req, reply) => reply.redirect("/dashboard/"));
    // Serve all /dashboard/* requests — static files or index.html fallback
    app.get("/dashboard/*", async (request, reply) => {
      const { readFile } = await import("fs/promises");
      const { existsSync: exists } = await import("fs");
      // Strip /dashboard prefix to get the file path
      const urlPath = (request.url as string).split("?")[0].replace(/^\/dashboard/, "") || "/";
      // Try exact file first, then index.html in that directory
      const candidates = [
        join(dashboardPath, urlPath),
        join(dashboardPath, urlPath, "index.html"),
        join(dashboardPath, "index.html"),
      ];
      for (const candidate of candidates) {
        if (exists(candidate) && !candidate.endsWith("/")) {
          const ext = candidate.split(".").pop() ?? "html";
          const mimeTypes: Record<string, string> = { html: "text/html", js: "application/javascript", css: "text/css", png: "image/png", svg: "image/svg+xml", json: "application/json", ico: "image/x-icon", txt: "text/plain" };
          const content = await readFile(candidate);
          return reply.type(mimeTypes[ext] ?? "application/octet-stream").send(content);
        }
      }
      // Fallback: serve index.html for client-side routing
      const content = await readFile(join(dashboardPath, "index.html"));
      return reply.type("text/html").send(content);
    });
  }

  // Services
  const authService = new AuthService(db, env);
  const aiService = new AIService(env);
  const billingReporter = new BillingReporter(env);
  billingReporter.start();
  const hourlyTrackerReporter = new HourlyTrackerReporter(env);
  const figmaService = new FigmaService(env);

  // Figma URL reader — used by the figma_read agent tool. Auth-required so
  // anonymous traffic can't burn through our team's Figma rate limit.
  app.get("/api/figma/read", { preHandler: requireAuth(authService) }, async (request, reply) => {
    const { url } = request.query as { url?: string };
    if (!url) return reply.status(400).send({ error: "Missing 'url' query param" });
    try {
      const result = await figmaService.readUrl(url);
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Use 422 so the agent gets a parseable error, not a generic 500
      return reply.status(422).send({ error: "Figma read failed", message: msg });
    }
  });

  // Model discovery endpoint
  app.get("/api/models", async () => ({
    models: aiService.getAvailableModels(),
    defaults: aiService.getDefaultModels(),
  }));

  // Commit-message generation — host posts a staged diff, we ask the model
  // for a Conventional-Commits-style message and return a single string.
  // Auth-gated; uses a small one-shot streamChat call so this doesn't pull
  // in agent loops or tools. Diff is capped client-side to ~16KB.
  app.post("/api/commit-message", { preHandler: requireAuth(authService) }, async (request, reply) => {
    const body = request.body as { diff?: unknown };
    const diff = typeof body?.diff === "string" ? body.diff : "";
    if (!diff.trim()) {
      return reply.status(400).send({ error: "diff is required" });
    }
    let message = "";
    await aiService.streamChat(
      [
        {
          role: "user",
          content:
            "Write a single Conventional-Commits-style commit message for this staged diff. " +
            "Output ONLY the message — no preamble, no explanation, no quote marks. " +
            "Use the form `type(scope): subject` for the first line (max 72 chars), then a blank line, " +
            "then 1-3 sentences of body explaining the WHY, not the WHAT. Skip the body if the change is trivial.\n\n" +
            "```diff\n" + diff + "\n```",
        },
      ],
      {
        onDelta: (text) => { message += text; },
        onEnd: () => {},
        onError: () => {},
      },
      { model: aiService.getDefaultModels().chatModel },
    );
    return reply.send({ message: message.trim() });
  });

  // Version endpoint — clients check this on startup for updates
  app.get("/api/version", async () => ({
    extension: { version: "0.2.11", downloadUrl: "https://apivscode.ailancers.com/dashboard/downloads/" },
    desktop: { version: "0.1.0", downloadUrl: "https://apivscode.ailancers.com/dashboard/downloads/" },
  }));

  // Check if user has an active session from a specific source (for duplicate detection)
  // Sessions started >4h ago without an end are treated as stale (crashed client). The
  // duplicate check should not block tracking forever just because some prior session
  // never called /session/end.
  app.get("/api/telemetry/active-session", { preHandler: requireAuth(authService) }, async (request, reply) => {
    const { source } = request.query as { source?: string };
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const [session] = await db
      .select({ id: activitySessions.id, editorVersion: activitySessions.editorVersion, startedAt: activitySessions.startedAt })
      .from(activitySessions)
      .where(and(
        eq(activitySessions.userId, request.user.sub),
        isNull(activitySessions.endedAt),
        gte(activitySessions.startedAt, fourHoursAgo),
        source ? like(activitySessions.editorVersion, `%${source}%`) : undefined,
      ))
      .orderBy(desc(activitySessions.startedAt))
      .limit(1);

    return reply.send({ hasActiveSession: !!session, session: session || null });
  });

  // Routes
  authRoutes(app, authService, db);
  chatRoutes(app, authService, db, aiService);
  chatWsRoute(app, authService, aiService, db, billingReporter);
  telemetryRoutes(app, authService, db);
  screenshotRoutes(app, authService, db, env);
  activityRoutes(app, authService, db);
  externalProjectsRoutes(app, authService, db);
  billingRoutes(app, authService, billingReporter);
  trackerRoutes(app, authService, hourlyTrackerReporter, db);

  return app;
}
