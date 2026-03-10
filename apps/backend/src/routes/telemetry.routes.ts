import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/requireAuth.js";
import type { AuthService } from "../services/AuthService.js";
import type { Database } from "../config/database.js";
import { activitySessions, telemetryEvents, projects } from "../models/index.js";

const sessionStartSchema = z.object({
  projectSlug: z.string(),
  editorVersion: z.string(),
  extensionVersion: z.string(),
  os: z.string(),
});

const heartbeatSchema = z.object({
  sessionId: z.string().uuid(),
  activeSeconds: z.number().int().min(0),
  idleSeconds: z.number().int().min(0),
  keystrokeCount: z.number().int().min(0),
  fileSaveCount: z.number().int().min(0),
  fileChangeCount: z.number().int().min(0),
  filesModified: z.record(z.object({ language: z.string(), changes: z.number() })),
  languageSeconds: z.record(z.number()),
  isCurrentlyIdle: z.boolean(),
});

const sessionEndSchema = z.object({
  sessionId: z.string().uuid(),
});

export function telemetryRoutes(app: FastifyInstance, authService: AuthService, db: Database) {
  const auth = requireAuth(authService);

  app.post("/api/telemetry/session/start", { preHandler: auth }, async (request, reply) => {
    const body = sessionStartSchema.parse(request.body);

    // Resolve project by slug
    let projectId: string | null = null;
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, body.projectSlug))
      .limit(1);
    if (project) projectId = project.id;

    const [session] = await db
      .insert(activitySessions)
      .values({
        userId: request.user.sub,
        projectId,
        startedAt: new Date(),
        editorVersion: body.editorVersion,
        extensionVersion: body.extensionVersion,
        osPlatform: body.os,
      })
      .returning();

    return reply.status(201).send({ sessionId: session.id });
  });

  app.post("/api/telemetry/session/heartbeat", { preHandler: auth }, async (request, reply) => {
    const body = heartbeatSchema.parse(request.body);

    // Accumulate into the activity session
    const [session] = await db
      .select()
      .from(activitySessions)
      .where(eq(activitySessions.id, body.sessionId))
      .limit(1);

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    await db
      .update(activitySessions)
      .set({
        activeSeconds: session.activeSeconds + body.activeSeconds,
        idleSeconds: session.idleSeconds + body.idleSeconds,
        totalKeystrokes: session.totalKeystrokes + body.keystrokeCount,
        totalFileSaves: session.totalFileSaves + body.fileSaveCount,
        totalFileChanges: session.totalFileChanges + body.fileChangeCount,
      })
      .where(eq(activitySessions.id, body.sessionId));

    // Insert heartbeat telemetry event
    await db.insert(telemetryEvents).values({
      userId: request.user.sub,
      sessionId: body.sessionId,
      projectId: session.projectId,
      eventType: "heartbeat",
      eventData: {
        activeSeconds: body.activeSeconds,
        idleSeconds: body.idleSeconds,
        keystrokeCount: body.keystrokeCount,
        fileSaveCount: body.fileSaveCount,
        languageSeconds: body.languageSeconds,
        isCurrentlyIdle: body.isCurrentlyIdle,
      },
    });

    return reply.send({ ok: true });
  });

  app.post("/api/telemetry/session/end", { preHandler: auth }, async (request, reply) => {
    const body = sessionEndSchema.parse(request.body);

    await db
      .update(activitySessions)
      .set({ endedAt: new Date() })
      .where(eq(activitySessions.id, body.sessionId));

    return reply.send({ ok: true });
  });
}
