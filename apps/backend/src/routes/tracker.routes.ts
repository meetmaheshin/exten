/**
 * Tracker routes — JWT-auth proxy for chat-ui hourly billing + public screenshot serving.
 *
 * Endpoints:
 *   GET  /api/tracker/status?subProjectId=...  (JWT) — proxies to chat-ui /hourly-billing/status
 *   POST /api/tracker/snapshot                  (JWT) — HMAC-signs and forwards to chat-ui
 *   GET  /api/tracker/screenshots/:id           (PUBLIC) — serves screenshot PNG from DB by UUID
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/requireAuth.js";
import type { AuthService } from "../services/AuthService.js";
import type { HourlyTrackerReporter } from "../services/HourlyTrackerReporter.js";
import type { Database } from "../config/database.js";
import { screenshots } from "../models/index.js";

const statusQuerySchema = z.object({
  subProjectId: z.string().min(1),
});

const snapshotBodySchema = z.object({
  slot_id: z.string().min(1),
  sub_project_id: z.string().min(1),
  lancer_user_id: z.string().min(1),
  slot_start: z.string().min(1),
  screenshot_url: z.string().nullable().optional(),
  screenshot_taken_at: z.string().nullable().optional(),
  keyboard_hits: z.number().int().min(0),
  mouse_hits: z.number().int().min(0),
  activity_percent: z.number().min(0).max(100),
  memo: z.string().nullable().optional(),
  active_window: z.string().nullable().optional(),
});

export function trackerRoutes(
  app: FastifyInstance,
  authService: AuthService,
  reporter: HourlyTrackerReporter,
  db: Database,
) {
  const auth = requireAuth(authService);

  // ── GET /api/tracker/status — proxy to chat-ui ──────────────────────
  app.get("/api/tracker/status", { preHandler: auth }, async (request, reply) => {
    if (!reporter.isEnabled()) {
      return reply.status(503).send({ error: "Hourly billing tracker not configured" });
    }
    const query = statusQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Missing subProjectId" });
    }
    const status = await reporter.getStatus(query.data.subProjectId);
    if (!status) {
      return reply.status(502).send({ error: "Failed to fetch tracker status from platform" });
    }
    return reply.send(status);
  });

  // ── POST /api/tracker/snapshot — sign + forward to chat-ui ──────────
  app.post("/api/tracker/snapshot", { preHandler: auth }, async (request, reply) => {
    if (!reporter.isEnabled()) {
      return reply.status(503).send({ error: "Hourly billing tracker not configured" });
    }
    const parsed = snapshotBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid snapshot payload",
        message: parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "),
      });
    }
    try {
      const status = await reporter.pushSnapshot(parsed.data);
      return reply.send(status);
    } catch (err) {
      const error = err as Error & { statusCode?: number; body?: string };
      return reply.status(error.statusCode ?? 502).send({
        error: "Snapshot ingestion failed",
        message: error.message,
        upstream_body: error.body ?? null,
      });
    }
  });

  // ── GET /api/tracker/screenshots/:id — PUBLIC, no auth ──────────────
  // Serves screenshot PNG from the existing `screenshots` table by UUID.
  // The chat-ui dashboard renders <img src="...this URL..."> and the
  // business user is NOT authenticated to the extension backend, so
  // this endpoint is public. The UUID is unguessable (acts as bearer).
  app.get("/api/tracker/screenshots/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!id || id.length < 10) {
      return reply.status(400).send({ error: "Invalid screenshot id" });
    }

    const [record] = await db
      .select({ imageData: screenshots.imageData })
      .from(screenshots)
      .where(eq(screenshots.id, id))
      .limit(1);

    if (!record || !record.imageData) {
      return reply.status(404).send({ error: "Screenshot not found" });
    }

    return reply
      .type("image/png")
      .header("Cache-Control", "public, max-age=604800") // 7 days — image is immutable
      .send(record.imageData);
  });
}
