import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/requireAuth.js";
import type { AuthService } from "../services/AuthService.js";
import type { Database } from "../config/database.js";
import { activitySessions, projects } from "../models/index.js";

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
  appUsage: z.record(z.number()).optional(),
  // External platform project/task being worked on (int for old habitnetwork, string UUID for v2 platform)
  externalProjectId: z.union([z.number().int().positive(), z.string()]).optional().nullable(),
  externalTaskId: z.union([z.number().int().positive(), z.string()]).optional().nullable(),
  subProjectId: z.string().uuid().optional().nullable(),
  // Display names for project/task — stored on the session so the dashboard can show them
  // without resolving the v2 platform on every read.
  projectName: z.string().max(200).optional().nullable(),
  taskName: z.string().max(200).optional().nullable(),
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

  // logLevel: "warn" silences Fastify's per-request access log for this
  // route — heartbeats fire every 60s per user, and "POST /heartbeat 200"
  // floods backend logs to the point where real errors get lost. The
  // server's normal error logger still works (warnings + errors still log).
  app.post("/api/telemetry/session/heartbeat", { preHandler: auth, logLevel: "warn" }, async (request, reply) => {
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

    // Wall-clock clamp: a heartbeat can never report more active+idle seconds
    // than the wall time elapsed since the last heartbeat (or session start).
    // Anchor comes from activity_sessions.last_heartbeat_at — previously we
    // queried telemetry_events for this, which forced an INSERT per heartbeat
    // for read-side support. The new column gives us the same answer with
    // zero extra rows.
    const anchor = session.lastHeartbeatAt ?? session.startedAt;
    const wallSeconds = Math.max(0, Math.floor((Date.now() - new Date(anchor).getTime()) / 1000));
    // 30s slack for clock skew + flush-loop jitter on top of the 60s interval
    const cap = wallSeconds + 30;
    const clampedActive = Math.min(body.activeSeconds, cap);
    const clampedIdle = Math.min(body.idleSeconds, Math.max(0, cap - clampedActive));
    if (clampedActive < body.activeSeconds || clampedIdle < body.idleSeconds) {
      app.log.warn({
        sessionId: body.sessionId,
        userId: request.user.sub,
        reportedActive: body.activeSeconds,
        reportedIdle: body.idleSeconds,
        cap,
        wallSeconds,
      }, "Heartbeat exceeded wall-clock cap — clamping");
    }

    // Build update — always accumulate metrics; update project/task if provided.
    // lastHeartbeatAt also gets updated here so the next heartbeat's clamp
    // anchor moves forward without a separate query/insert.
    const updateValues: Record<string, unknown> = {
      activeSeconds: session.activeSeconds + clampedActive,
      idleSeconds: session.idleSeconds + clampedIdle,
      totalKeystrokes: session.totalKeystrokes + body.keystrokeCount,
      totalFileSaves: session.totalFileSaves + body.fileSaveCount,
      totalFileChanges: session.totalFileChanges + body.fileChangeCount,
      lastHeartbeatAt: new Date(),
    };
    // The DB column is an integer FK to the legacy external_projects table.
    // The new v2 platform sends UUID strings — those don't fit, so skip them
    // (the platform itself owns project membership). Only legacy numeric IDs
    // get written through.
    if (body.externalProjectId !== undefined) {
      updateValues.externalProjectId =
        typeof body.externalProjectId === "number" ? body.externalProjectId : null;
    }
    if (body.externalTaskId !== undefined) {
      updateValues.externalTaskId =
        typeof body.externalTaskId === "number" ? body.externalTaskId : null;
    }
    // Store display names whenever the client sends them
    if (body.projectName !== undefined) {
      updateValues.projectName = body.projectName ?? null;
    }
    if (body.taskName !== undefined) {
      updateValues.taskName = body.taskName ?? null;
    }

    // Merge app usage accumulation
    if (body.appUsage) {
      const existingAppUsage = (session.appUsage || {}) as Record<string, number>;
      for (const [app, secs] of Object.entries(body.appUsage)) {
        existingAppUsage[app] = (existingAppUsage[app] || 0) + secs;
      }
      updateValues.appUsage = existingAppUsage;
    }

    await db
      .update(activitySessions)
      .set(updateValues)
      .where(eq(activitySessions.id, body.sessionId));

    // Previously inserted one row into telemetry_events per heartbeat to keep
    // a "history" of heartbeats — nothing in the codebase ever READ those
    // rows except the wall-clock clamp lookup above, which now uses
    // session.last_heartbeat_at instead. Dropping the INSERT cuts
    // ~24,000 rows/day (50 users × 60 hb/h × 8h) and the noisy
    // POST/heartbeat 200 access log line. See migration 0013 for cleanup
    // of historical heartbeat events that already accumulated.

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
