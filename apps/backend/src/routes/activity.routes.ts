import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, gte, lte, desc, sql, asc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/requireAuth.js";
import type { AuthService } from "../services/AuthService.js";
import type { Database } from "../config/database.js";
import { activitySessions, users, aiUsageDaily } from "../models/index.js";

const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const userIdParam = z.object({
  userId: z.string().uuid(),
});

export function activityRoutes(app: FastifyInstance, authService: AuthService, db: Database) {
  const auth = requireAuth(authService);
  const admin = requireAdmin(authService);

  // ─── Developer's own activity ───

  // Get my activity sessions
  app.get("/api/activity/me/sessions", { preHandler: auth }, async (request, reply) => {
    const query = dateRangeSchema.parse(request.query);

    const conditions = [eq(activitySessions.userId, request.user.sub)];
    if (query.from) conditions.push(gte(activitySessions.startedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(activitySessions.startedAt, new Date(query.to)));

    const sessions = await db
      .select()
      .from(activitySessions)
      .where(and(...conditions))
      .orderBy(desc(activitySessions.startedAt))
      .limit(query.limit)
      .offset(query.offset);

    return reply.send({ data: sessions });
  });

  // Get my activity summary (aggregated)
  app.get("/api/activity/me/summary", { preHandler: auth }, async (request, reply) => {
    const query = dateRangeSchema.parse(request.query);

    const conditions = [eq(activitySessions.userId, request.user.sub)];
    if (query.from) conditions.push(gte(activitySessions.startedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(activitySessions.startedAt, new Date(query.to)));

    const [summary] = await db
      .select({
        totalSessions: sql<number>`count(*)::int`,
        totalActiveSeconds: sql<number>`coalesce(sum(${activitySessions.activeSeconds}), 0)::int`,
        totalIdleSeconds: sql<number>`coalesce(sum(${activitySessions.idleSeconds}), 0)::int`,
        totalKeystrokes: sql<number>`coalesce(sum(${activitySessions.totalKeystrokes}), 0)::int`,
        totalFileSaves: sql<number>`coalesce(sum(${activitySessions.totalFileSaves}), 0)::int`,
        totalFileChanges: sql<number>`coalesce(sum(${activitySessions.totalFileChanges}), 0)::int`,
      })
      .from(activitySessions)
      .where(and(...conditions));

    return reply.send({ data: summary });
  });

  // Get my daily activity breakdown
  app.get("/api/activity/me/daily", { preHandler: auth }, async (request, reply) => {
    const query = dateRangeSchema.parse(request.query);

    const conditions = [eq(activitySessions.userId, request.user.sub)];
    if (query.from) conditions.push(gte(activitySessions.startedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(activitySessions.startedAt, new Date(query.to)));

    const daily = await db
      .select({
        date: sql<string>`date(${activitySessions.startedAt})`,
        activeSeconds: sql<number>`coalesce(sum(${activitySessions.activeSeconds}), 0)::int`,
        idleSeconds: sql<number>`coalesce(sum(${activitySessions.idleSeconds}), 0)::int`,
        keystrokes: sql<number>`coalesce(sum(${activitySessions.totalKeystrokes}), 0)::int`,
        fileSaves: sql<number>`coalesce(sum(${activitySessions.totalFileSaves}), 0)::int`,
        sessions: sql<number>`count(*)::int`,
      })
      .from(activitySessions)
      .where(and(...conditions))
      .groupBy(sql`date(${activitySessions.startedAt})`)
      .orderBy(asc(sql`date(${activitySessions.startedAt})`))
      .limit(query.limit);

    return reply.send({ data: daily });
  });

  // ─── Admin: Team-wide activity ───

  // Get overview for all developers
  app.get("/api/admin/activity/overview", { preHandler: admin }, async (request, reply) => {
    const query = dateRangeSchema.parse(request.query);

    const conditions = [];
    if (query.from) conditions.push(gte(activitySessions.startedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(activitySessions.startedAt, new Date(query.to)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const overview = await db
      .select({
        userId: activitySessions.userId,
        email: users.email,
        fullName: users.fullName,
        team: users.team,
        totalActiveSeconds: sql<number>`coalesce(sum(${activitySessions.activeSeconds}), 0)::int`,
        totalIdleSeconds: sql<number>`coalesce(sum(${activitySessions.idleSeconds}), 0)::int`,
        totalKeystrokes: sql<number>`coalesce(sum(${activitySessions.totalKeystrokes}), 0)::int`,
        totalFileSaves: sql<number>`coalesce(sum(${activitySessions.totalFileSaves}), 0)::int`,
        sessionCount: sql<number>`count(*)::int`,
        lastActive: sql<string>`max(${activitySessions.startedAt})`,
      })
      .from(activitySessions)
      .innerJoin(users, eq(activitySessions.userId, users.id))
      .where(whereClause)
      .groupBy(activitySessions.userId, users.email, users.fullName, users.team)
      .orderBy(desc(sql`sum(${activitySessions.activeSeconds})`))
      .limit(query.limit)
      .offset(query.offset);

    return reply.send({ data: overview });
  });

  // Get detailed activity for a specific user
  app.get("/api/admin/activity/user/:userId", { preHandler: admin }, async (request, reply) => {
    const { userId } = userIdParam.parse(request.params);
    const query = dateRangeSchema.parse(request.query);

    const conditions = [eq(activitySessions.userId, userId)];
    if (query.from) conditions.push(gte(activitySessions.startedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(activitySessions.startedAt, new Date(query.to)));

    const sessions = await db
      .select()
      .from(activitySessions)
      .where(and(...conditions))
      .orderBy(desc(activitySessions.startedAt))
      .limit(query.limit)
      .offset(query.offset);

    // Also get summary
    const [summary] = await db
      .select({
        totalActiveSeconds: sql<number>`coalesce(sum(${activitySessions.activeSeconds}), 0)::int`,
        totalIdleSeconds: sql<number>`coalesce(sum(${activitySessions.idleSeconds}), 0)::int`,
        totalKeystrokes: sql<number>`coalesce(sum(${activitySessions.totalKeystrokes}), 0)::int`,
        totalFileSaves: sql<number>`coalesce(sum(${activitySessions.totalFileSaves}), 0)::int`,
        sessionCount: sql<number>`count(*)::int`,
      })
      .from(activitySessions)
      .where(and(...conditions));

    // Get AI usage
    const aiConditions = [eq(aiUsageDaily.userId, userId)];
    if (query.from) aiConditions.push(gte(aiUsageDaily.date, query.from.slice(0, 10)));
    if (query.to) aiConditions.push(lte(aiUsageDaily.date, query.to.slice(0, 10)));

    const [aiSummary] = await db
      .select({
        totalRequests: sql<number>`coalesce(sum(${aiUsageDaily.totalRequests}), 0)::int`,
        totalInputTokens: sql<number>`coalesce(sum(${aiUsageDaily.totalInputTokens}), 0)::int`,
        totalOutputTokens: sql<number>`coalesce(sum(${aiUsageDaily.totalOutputTokens}), 0)::int`,
        totalCostUsd: sql<string>`coalesce(sum(${aiUsageDaily.totalCostUsd}), 0)`,
      })
      .from(aiUsageDaily)
      .where(and(...aiConditions));

    return reply.send({
      summary,
      aiUsage: aiSummary,
      sessions,
    });
  });

  // Team daily aggregate for charts
  app.get("/api/admin/activity/daily", { preHandler: admin }, async (request, reply) => {
    const query = dateRangeSchema.parse(request.query);

    const conditions = [];
    if (query.from) conditions.push(gte(activitySessions.startedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(activitySessions.startedAt, new Date(query.to)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const daily = await db
      .select({
        date: sql<string>`date(${activitySessions.startedAt})`,
        totalActiveSeconds: sql<number>`coalesce(sum(${activitySessions.activeSeconds}), 0)::int`,
        totalIdleSeconds: sql<number>`coalesce(sum(${activitySessions.idleSeconds}), 0)::int`,
        totalKeystrokes: sql<number>`coalesce(sum(${activitySessions.totalKeystrokes}), 0)::int`,
        activeDevelopers: sql<number>`count(distinct ${activitySessions.userId})::int`,
        sessionCount: sql<number>`count(*)::int`,
      })
      .from(activitySessions)
      .where(whereClause)
      .groupBy(sql`date(${activitySessions.startedAt})`)
      .orderBy(asc(sql`date(${activitySessions.startedAt})`))
      .limit(query.limit);

    return reply.send({ data: daily });
  });
}
