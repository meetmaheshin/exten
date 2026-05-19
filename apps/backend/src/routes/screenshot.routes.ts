import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, desc, and, gte, lte, inArray, sql, isNull, isNotNull } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/requireAuth.js";
import type { AuthService } from "../services/AuthService.js";
import type { Database } from "../config/database.js";
import type { Env } from "../config/env.js";
import { screenshots, activitySessions, users } from "../models/index.js";

const uploadSchema = z.object({
  sessionId: z.string().uuid(),
  filename: z.string().max(255),
  imageBase64: z.string(),
  capturedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
  // Sub-project this screenshot is attributed to. Required for chat-ui
  // billing pipeline. Captured as varchar to mirror the rest of the
  // codebase (platform UUIDs are sent as strings).
  subProjectId: z.string().max(64).optional().nullable(),
});

const querySchema = z.object({
  userId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  // Bumped from 100 → 500 because admins viewing a full day across the team
  // routinely exceed 100 (one shot per 5 min × 8h × 5 people = 480).
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function screenshotRoutes(
  app: FastifyInstance,
  authService: AuthService,
  db: Database,
  env: Env
) {
  const auth = requireAuth(authService);
  const admin = requireAdmin(authService);

  // Upload screenshot from extension — store image in DB
  app.post("/api/telemetry/screenshot", { preHandler: auth }, async (request, reply) => {
    const body = uploadSchema.parse(request.body);

    // Super-admin kill switch: refuse uploads from users whose
    // `screenshotsDisabled` flag is on. Returns a stable error code the
    // extension uses to stop scheduling captures locally.
    const [me] = await db
      .select({ screenshotsDisabled: users.screenshotsDisabled })
      .from(users)
      .where(eq(users.id, request.user.sub))
      .limit(1);
    if (me?.screenshotsDisabled) {
      return reply.status(403).send({
        error: "screenshots_disabled",
        message: "Screenshots are disabled for your account by an admin.",
      });
    }

    // Validate base64 size
    const imageBuffer = Buffer.from(body.imageBase64, "base64");
    const maxBytes = env.SCREENSHOT_MAX_SIZE_MB * 1024 * 1024;
    if (imageBuffer.length > maxBytes) {
      return reply.status(413).send({
        error: "Screenshot too large",
        message: `Max size is ${env.SCREENSHOT_MAX_SIZE_MB}MB`,
      });
    }

    // Verify the session belongs to this user
    const [session] = await db
      .select({ userId: activitySessions.userId, projectId: activitySessions.projectId })
      .from(activitySessions)
      .where(eq(activitySessions.id, body.sessionId))
      .limit(1);

    if (!session || session.userId !== request.user.sub) {
      return reply.status(403).send({ error: "Session not found or unauthorized" });
    }

    // Save record with image data in DB. sub_project_id is persisted on
    // every new row so chat-ui can directly attribute each screenshot for
    // billing. Clients refuse to capture when no sub-project is selected,
    // so for new rows this should be non-null in practice — but we still
    // accept null here as a safety net (e.g. manual entries from admins).
    const [record] = await db
      .insert(screenshots)
      .values({
        userId: request.user.sub,
        sessionId: body.sessionId,
        projectId: session.projectId,
        filename: body.filename,
        storagePath: "",
        imageData: imageBuffer,
        fileSizeBytes: imageBuffer.length,
        metadata: body.metadata ?? {},
        capturedAt: new Date(body.capturedAt),
        subProjectId: body.subProjectId ?? null,
      })
      .returning();

    return reply.status(201).send({ id: record.id });
  });

  // Get screenshots for the authenticated user
  app.get("/api/telemetry/screenshots/me", { preHandler: auth }, async (request, reply) => {
    const query = querySchema.parse(request.query);

    // isNull(deletedAt) — hide soft-deleted shots from user-facing listings.
    // Payroll-impacting reads must do the same; deleted rows are kept only for
    // audit trail, not for display.
    //
    // isNotNull(imageData) — hide manual-entry placeholder rows. They carry
    // filename "manual-entry.png" but no actual PNG bytes; the image-serve
    // endpoint 404's them, which floods the browser console with broken-
    // image errors in the gallery. Placeholders still count toward billable
    // seconds (count × 300), they just don't show up as thumbnails.
    const conditions = [
      eq(screenshots.userId, request.user.sub),
      isNull(screenshots.deletedAt),
      isNotNull(screenshots.imageData),
    ];
    if (query.from) conditions.push(gte(screenshots.capturedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(screenshots.capturedAt, new Date(query.to)));
    if (query.sessionId) conditions.push(eq(screenshots.sessionId, query.sessionId));

    const results = await db
      .select({
        id: screenshots.id,
        filename: screenshots.filename,
        fileSizeBytes: screenshots.fileSizeBytes,
        metadata: screenshots.metadata,
        capturedAt: screenshots.capturedAt,
        sessionId: screenshots.sessionId,
      })
      .from(screenshots)
      .where(and(...conditions))
      .orderBy(desc(screenshots.capturedAt))
      .limit(query.limit)
      .offset(query.offset);

    const [{ total } = { total: 0 }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(screenshots)
      .where(and(...conditions));

    return reply.send({ data: results, total, limit: query.limit, offset: query.offset });
  });

  // Admin: get screenshots for any user
  app.get("/api/admin/screenshots", { preHandler: admin }, async (request, reply) => {
    const query = querySchema.parse(request.query);

    // Admins also see only live screenshots by default. If we ever want a
    // dedicated "audit deleted" view we can add ?includeDeleted=true; for now
    // every payroll-impacting read filters identically. isNotNull(imageData)
    // also skips manual-entry placeholders — same reason as in /me listing.
    const conditions = [isNull(screenshots.deletedAt), isNotNull(screenshots.imageData)];
    if (query.userId) conditions.push(eq(screenshots.userId, query.userId));
    if (query.from) conditions.push(gte(screenshots.capturedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(screenshots.capturedAt, new Date(query.to)));
    if (query.sessionId) conditions.push(eq(screenshots.sessionId, query.sessionId));

    const whereClause = and(...conditions);

    const results = await db
      .select({
        id: screenshots.id,
        userId: screenshots.userId,
        userName: users.fullName,
        userEmail: users.email,
        filename: screenshots.filename,
        fileSizeBytes: screenshots.fileSizeBytes,
        metadata: screenshots.metadata,
        capturedAt: screenshots.capturedAt,
        sessionId: screenshots.sessionId,
      })
      .from(screenshots)
      .leftJoin(users, eq(screenshots.userId, users.id))
      .where(whereClause)
      .orderBy(desc(screenshots.capturedAt))
      .limit(query.limit)
      .offset(query.offset);

    // Total count for pagination — using sql<number> instead of count() because Drizzle's count() needs a different import we don't have here
    const [{ total } = { total: 0 }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(screenshots)
      .leftJoin(users, eq(screenshots.userId, users.id))
      .where(whereClause);

    return reply.send({ data: results, total, limit: query.limit, offset: query.offset });
  });

  // Serve screenshot image by id — read from DB
  app.get("/api/telemetry/screenshots/:id/image", { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [record] = await db
      .select({
        userId: screenshots.userId,
        imageData: screenshots.imageData,
        storagePath: screenshots.storagePath,
        deletedAt: screenshots.deletedAt,
      })
      .from(screenshots)
      .where(eq(screenshots.id, id))
      .limit(1);

    if (!record) {
      return reply.status(404).send({ error: "Screenshot not found" });
    }
    // Soft-deleted: return 410 Gone so callers can distinguish from
    // never-existed (404). Cached <img> tags in old dashboards will see
    // a clean broken-image instead of mistakenly displaying the photo.
    if (record.deletedAt) {
      return reply.status(410).send({ error: "Screenshot deleted" });
    }

    // Non-admin users can only view their own screenshots. Both `admin`
    // and `super_admin` get cross-user access — matches the pattern in
    // activity.routes.ts. Without `super_admin` here, super-admins were
    // hitting 403 on every screenshot thumbnail in the dashboard.
    const isAdmin = request.user.role === "admin" || request.user.role === "super_admin";
    if (record.userId !== request.user.sub && !isAdmin) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    // Serve from DB if available
    if (record.imageData) {
      return reply
        .type("image/png")
        .header("Cache-Control", "private, max-age=3600")
        .send(record.imageData);
    }

    return reply.status(404).send({ error: "Screenshot image not found" });
  });

  // ─── Soft-delete ────────────────────────────────────────────────────────
  // We no longer hard-delete or call deductTimeForScreenshot. Payroll reads
  // billable seconds as `count(live screenshots) * 300`, so removing a row
  // (by setting deletedAt) automatically subtracts 5 min from that user's
  // hours. The old `active_seconds` math has been retired — see migration
  // 0011_screenshots_soft_delete.sql.
  const SCREENSHOT_INTERVAL_SECONDS = 300; // 5 minutes — kept for the response payload only

  // User: soft-delete own screenshot.
  // Effect on payroll: removes 5 min from the user's billable hours.
  // Audit: deleted_at + deleted_by are set so HR can trace it back.
  app.delete("/api/telemetry/screenshots/:id", { preHandler: auth }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = (request.body as { reason?: string } | undefined) ?? {};

      const [ss] = await db
        .select({ userId: screenshots.userId, deletedAt: screenshots.deletedAt })
        .from(screenshots)
        .where(eq(screenshots.id, id))
        .limit(1);

      if (!ss) return reply.status(404).send({ error: "Screenshot not found" });
      if (ss.userId !== request.user.sub) return reply.status(403).send({ error: "Not your screenshot" });
      // Idempotent: deleting an already-deleted row succeeds without double-counting.
      if (ss.deletedAt) return reply.send({ ok: true, alreadyDeleted: true });

      await db
        .update(screenshots)
        .set({
          deletedAt: new Date(),
          deletedBy: request.user.sub,
          deletedReason: body.reason ?? null,
        })
        .where(eq(screenshots.id, id));

      return reply.send({ ok: true, timeDeducted: SCREENSHOT_INTERVAL_SECONDS });
    } catch (err) {
      console.error("[Screenshots] User delete failed:", err);
      return reply.status(500).send({ error: "Delete failed", message: String(err) });
    }
  });

  // Admin: soft-delete a single screenshot.
  app.delete("/api/admin/screenshots/:id", { preHandler: admin }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = (request.body as { reason?: string } | undefined) ?? {};
      const [ss] = await db
        .select({ deletedAt: screenshots.deletedAt })
        .from(screenshots)
        .where(eq(screenshots.id, id))
        .limit(1);
      if (!ss) return reply.status(404).send({ error: "Screenshot not found" });
      if (ss.deletedAt) return reply.send({ ok: true, alreadyDeleted: true });
      await db
        .update(screenshots)
        .set({
          deletedAt: new Date(),
          deletedBy: request.user.sub,
          deletedReason: body.reason ?? null,
        })
        .where(eq(screenshots.id, id));
      return reply.send({ ok: true, timeDeducted: SCREENSHOT_INTERVAL_SECONDS });
    } catch (err) {
      console.error("[Screenshots] Delete failed:", err);
      return reply.status(500).send({ error: "Delete failed", message: String(err) });
    }
  });

  // Admin: bulk soft-delete screenshots.
  app.post("/api/admin/screenshots/bulk-delete", { preHandler: admin }, async (request, reply) => {
    try {
      const body = z.object({
        ids: z.array(z.string().uuid()).min(1).max(500),
        reason: z.string().max(500).optional(),
      }).parse(request.body);
      await db
        .update(screenshots)
        .set({
          deletedAt: new Date(),
          deletedBy: request.user.sub,
          deletedReason: body.reason ?? null,
        })
        .where(and(inArray(screenshots.id, body.ids), isNull(screenshots.deletedAt)));
      return reply.send({ ok: true, deleted: body.ids.length });
    } catch (err) {
      console.error("[Screenshots] Bulk delete failed:", err);
      return reply.status(500).send({ error: "Bulk delete failed", message: String(err) });
    }
  });

  // Admin: soft-delete all screenshots for a user.
  // High-blast-radius operation — requires explicit confirmation in the
  // request body so a stray DELETE can't wipe someone's whole month.
  app.delete("/api/admin/screenshots/user/:userId", { preHandler: admin }, async (request, reply) => {
    try {
      const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
      const body = (request.body as { reason?: string; confirmAll?: boolean } | undefined) ?? {};
      if (!body.confirmAll) {
        return reply.status(400).send({
          error: "Confirmation required",
          message: "Pass confirmAll:true in the body to soft-delete every screenshot for this user.",
        });
      }
      const result = await db
        .update(screenshots)
        .set({
          deletedAt: new Date(),
          deletedBy: request.user.sub,
          deletedReason: body.reason ?? "Admin bulk delete (all for user)",
        })
        .where(and(eq(screenshots.userId, userId), isNull(screenshots.deletedAt)))
        .returning({ id: screenshots.id });
      return reply.send({ ok: true, deleted: result.length });
    } catch (err) {
      console.error("[Screenshots] User delete failed:", err);
      return reply.status(500).send({ error: "Delete failed", message: String(err) });
    }
  });
}
