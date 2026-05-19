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
      request.log.warn(
        "[tracker.status] reporter disabled (AILANCERS_BILLING_API_URL or HMAC_SECRET missing)",
      );
      return reply.status(503).send({ error: "Hourly billing tracker not configured" });
    }
    const query = statusQuerySchema.safeParse(request.query);
    if (!query.success) {
      request.log.warn({ query: request.query }, "[tracker.status] bad query");
      return reply.status(400).send({ error: "Missing subProjectId" });
    }
    const lancerUserId = request.user?.platformUserId ?? null;
    request.log.info(
      {
        sub_project_id: query.data.subProjectId,
        lancer_user_id: lancerUserId,
        local_user_sub: request.user?.sub,
        authed_via: lancerUserId ? "platform" : "local",
      },
      "[tracker.status] fetching",
    );
    const status = await reporter.getStatus(query.data.subProjectId, lancerUserId);
    if (!status) {
      request.log.error(
        { sub_project_id: query.data.subProjectId, lancer_user_id: lancerUserId },
        "[tracker.status] reporter.getStatus returned null (upstream error)",
      );
      return reply.status(502).send({ error: "Failed to fetch tracker status from platform" });
    }
    request.log.info(
      {
        sub_project_id: query.data.subProjectId,
        is_hourly: status.is_hourly,
        billing_status: status.billing_status,
        returned_lancer_user_id: status.lancer_user_id,
        suspended: status.suspended,
        limit_reached: status.limit_reached,
      },
      "[tracker.status] upstream OK",
    );
    return reply.send(status);
  });

  // ── POST /api/tracker/snapshot — sign + forward to chat-ui ──────────
  app.post("/api/tracker/snapshot", { preHandler: auth }, async (request, reply) => {
    if (!reporter.isEnabled()) {
      request.log.warn("[tracker.snapshot] reporter disabled");
      return reply.status(503).send({ error: "Hourly billing tracker not configured" });
    }
    const parsed = snapshotBodySchema.safeParse(request.body);
    if (!parsed.success) {
      request.log.warn(
        {
          err_count: parsed.error.errors.length,
          errors: parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
        },
        "[tracker.snapshot] payload validation failed",
      );
      return reply.status(400).send({
        error: "Invalid snapshot payload",
        message: parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "),
      });
    }
    const callerId = request.user?.platformUserId ?? null;
    if (callerId && parsed.data.lancer_user_id !== callerId) {
      request.log.warn(
        { caller: callerId, payload_lancer: parsed.data.lancer_user_id },
        "[tracker.snapshot] identity mismatch",
      );
      return reply.status(403).send({
        error: "Snapshot lancer_user_id does not match authenticated user",
      });
    }
    request.log.info(
      {
        slot_id: parsed.data.slot_id,
        sub_project_id: parsed.data.sub_project_id,
        lancer_user_id: parsed.data.lancer_user_id,
        slot_start: parsed.data.slot_start,
        keyboard_hits: parsed.data.keyboard_hits,
        mouse_hits: parsed.data.mouse_hits,
        activity_percent: parsed.data.activity_percent,
        has_screenshot: !!parsed.data.screenshot_url,
      },
      "[tracker.snapshot] forwarding to chat-ui",
    );
    try {
      const status = await reporter.pushSnapshot(parsed.data);
      request.log.info(
        {
          slot_id: parsed.data.slot_id,
          is_hourly: status.is_hourly,
          billing_status: status.billing_status,
          suspended: status.suspended,
          limit_reached: status.limit_reached,
        },
        "[tracker.snapshot] chat-ui accepted",
      );
      return reply.send(status);
    } catch (err) {
      const error = err as Error & { statusCode?: number; body?: string };
      request.log.error(
        {
          slot_id: parsed.data.slot_id,
          status: error.statusCode,
          body: error.body,
          message: error.message,
        },
        "[tracker.snapshot] chat-ui rejected",
      );
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
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  app.get("/api/tracker/screenshots/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!id || !UUID_RE.test(id)) {
      return reply.status(400).send({ error: "Invalid screenshot id" });
    }

    const [record] = await db
      .select({ imageData: screenshots.imageData, deletedAt: screenshots.deletedAt })
      .from(screenshots)
      .where(eq(screenshots.id, id))
      .limit(1);

    if (!record || !record.imageData) {
      return reply.status(404).send({ error: "Screenshot not found" });
    }
    // Soft-deleted: 410 Gone so the chat-ui hourly dashboard shows broken
    // image instead of leaking content that was removed for payroll reasons.
    if (record.deletedAt) {
      return reply.status(410).send({ error: "Screenshot deleted" });
    }

    return reply
      .type("image/png")
      .header("Cache-Control", "public, max-age=604800") // 7 days — image is immutable
      .send(record.imageData);
  });
}
