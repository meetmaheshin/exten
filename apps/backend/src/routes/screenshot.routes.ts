import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, desc, and, gte, lte, inArray, sql } from "drizzle-orm";
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
});

const querySchema = z.object({
  userId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
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

    // Save record with image data in DB
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
      })
      .returning();

    return reply.status(201).send({ id: record.id });
  });

  // Get screenshots for the authenticated user
  app.get("/api/telemetry/screenshots/me", { preHandler: auth }, async (request, reply) => {
    const query = querySchema.parse(request.query);

    const conditions = [eq(screenshots.userId, request.user.sub)];
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

    return reply.send({ data: results });
  });

  // Admin: get screenshots for any user
  app.get("/api/admin/screenshots", { preHandler: admin }, async (request, reply) => {
    const query = querySchema.parse(request.query);

    const conditions = [];
    if (query.userId) conditions.push(eq(screenshots.userId, query.userId));
    if (query.from) conditions.push(gte(screenshots.capturedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(screenshots.capturedAt, new Date(query.to)));
    if (query.sessionId) conditions.push(eq(screenshots.sessionId, query.sessionId));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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

    return reply.send({ data: results });
  });

  // Serve screenshot image by id — read from DB
  app.get("/api/telemetry/screenshots/:id/image", { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [record] = await db
      .select({
        userId: screenshots.userId,
        imageData: screenshots.imageData,
        storagePath: screenshots.storagePath,
      })
      .from(screenshots)
      .where(eq(screenshots.id, id))
      .limit(1);

    if (!record) {
      return reply.status(404).send({ error: "Screenshot not found" });
    }

    // Non-admin users can only view their own screenshots
    if (record.userId !== request.user.sub && request.user.role !== "admin") {
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

  // Helper: deduct screenshot interval time from the associated session
  const SCREENSHOT_INTERVAL_SECONDS = 300; // 5 minutes
  async function deductTimeForScreenshot(screenshotId: string): Promise<void> {
    try {
      const [ss] = await db
        .select({ sessionId: screenshots.sessionId })
        .from(screenshots)
        .where(eq(screenshots.id, screenshotId))
        .limit(1);

      if (ss?.sessionId) {
        await db.execute(
          sql`UPDATE activity_sessions
              SET active_seconds = GREATEST(active_seconds - ${SCREENSHOT_INTERVAL_SECONDS}, 0)
              WHERE id = ${ss.sessionId}`
        );
        console.log(`[Screenshots] Deducted ${SCREENSHOT_INTERVAL_SECONDS}s from session ${ss.sessionId}`);
      }
    } catch (err) {
      console.error("[Screenshots] Failed to deduct time:", err);
    }
  }

  // User: delete own screenshot (deducts time from session)
  app.delete("/api/telemetry/screenshots/:id", { preHandler: auth }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

      // Verify ownership
      const [ss] = await db
        .select({ userId: screenshots.userId })
        .from(screenshots)
        .where(eq(screenshots.id, id))
        .limit(1);

      if (!ss) return reply.status(404).send({ error: "Screenshot not found" });
      if (ss.userId !== request.user.sub) return reply.status(403).send({ error: "Not your screenshot" });

      // Deduct time from session
      await deductTimeForScreenshot(id);

      // Delete
      await db.delete(screenshots).where(eq(screenshots.id, id));
      return reply.send({ ok: true, timeDeducted: SCREENSHOT_INTERVAL_SECONDS });
    } catch (err) {
      console.error("[Screenshots] User delete failed:", err);
      return reply.status(500).send({ error: "Delete failed", message: String(err) });
    }
  });

  // Admin: delete a single screenshot (also deducts time)
  app.delete("/api/admin/screenshots/:id", { preHandler: admin }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      await deductTimeForScreenshot(id);
      await db.delete(screenshots).where(eq(screenshots.id, id));
      return reply.send({ ok: true, timeDeducted: SCREENSHOT_INTERVAL_SECONDS });
    } catch (err) {
      console.error("[Screenshots] Delete failed:", err);
      return reply.status(500).send({ error: "Delete failed", message: String(err) });
    }
  });

  // Admin: bulk delete screenshots
  app.post("/api/admin/screenshots/bulk-delete", { preHandler: admin }, async (request, reply) => {
    try {
      const body = z.object({
        ids: z.array(z.string().uuid()).min(1).max(500),
      }).parse(request.body);
      await db.delete(screenshots).where(inArray(screenshots.id, body.ids));
      return reply.send({ ok: true });
    } catch (err) {
      console.error("[Screenshots] Bulk delete failed:", err);
      return reply.status(500).send({ error: "Bulk delete failed", message: String(err) });
    }
  });

  // Admin: delete all screenshots for a user
  app.delete("/api/admin/screenshots/user/:userId", { preHandler: admin }, async (request, reply) => {
    try {
      const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
      await db.delete(screenshots).where(eq(screenshots.userId, userId));
      return reply.send({ ok: true });
    } catch (err) {
      console.error("[Screenshots] User delete failed:", err);
      return reply.status(500).send({ error: "Delete failed", message: String(err) });
    }
  });
}
