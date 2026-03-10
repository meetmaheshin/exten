import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import { requireAuth, requireAdmin } from "../middleware/requireAuth.js";
import type { AuthService } from "../services/AuthService.js";
import type { Database } from "../config/database.js";
import type { Env } from "../config/env.js";
import { screenshots, activitySessions } from "../models/index.js";

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

  // Upload screenshot from extension
  app.post("/api/telemetry/screenshot", { preHandler: auth }, async (request, reply) => {
    const body = uploadSchema.parse(request.body);

    // Validate base64 size
    const sizeBytes = Buffer.byteLength(body.imageBase64, "base64");
    const maxBytes = env.SCREENSHOT_MAX_SIZE_MB * 1024 * 1024;
    if (sizeBytes > maxBytes) {
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

    // Create storage directory: data/screenshots/{userId}/{YYYY-MM-DD}/
    const capturedDate = new Date(body.capturedAt);
    const dateDir = capturedDate.toISOString().slice(0, 10);
    const userDir = path.join(env.SCREENSHOT_STORAGE_DIR, request.user.sub, dateDir);
    await fs.promises.mkdir(userDir, { recursive: true });

    // Write file
    const storagePath = path.join(userDir, body.filename);
    const imageBuffer = Buffer.from(body.imageBase64, "base64");
    await fs.promises.writeFile(storagePath, imageBuffer);

    // Save record
    const [record] = await db
      .insert(screenshots)
      .values({
        userId: request.user.sub,
        sessionId: body.sessionId,
        projectId: session.projectId,
        filename: body.filename,
        storagePath,
        fileSizeBytes: imageBuffer.length,
        metadata: body.metadata ?? {},
        capturedAt: capturedDate,
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
        filename: screenshots.filename,
        fileSizeBytes: screenshots.fileSizeBytes,
        metadata: screenshots.metadata,
        capturedAt: screenshots.capturedAt,
        sessionId: screenshots.sessionId,
      })
      .from(screenshots)
      .where(whereClause)
      .orderBy(desc(screenshots.capturedAt))
      .limit(query.limit)
      .offset(query.offset);

    return reply.send({ data: results });
  });

  // Serve screenshot image by id (auth required)
  app.get("/api/telemetry/screenshots/:id/image", { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [record] = await db
      .select()
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

    try {
      const imageBuffer = await fs.promises.readFile(record.storagePath);
      return reply
        .type("image/png")
        .header("Cache-Control", "private, max-age=3600")
        .send(imageBuffer);
    } catch {
      return reply.status(404).send({ error: "Screenshot file not found" });
    }
  });
}
