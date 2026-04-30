import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, gte, lte, desc, sql, asc } from "drizzle-orm";
import { requireAuth, requireAdmin, requireManager } from "../middleware/requireAuth.js";
import type { AuthService } from "../services/AuthService.js";
import type { Database } from "../config/database.js";
import { activitySessions, users, aiUsageDaily, screenshots } from "../models/index.js";

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
        totalActiveSeconds: sql<number>`coalesce(sum(${activitySessions.activeSeconds}), 0)::int`,
        totalIdleSeconds: sql<number>`coalesce(sum(${activitySessions.idleSeconds}), 0)::int`,
        totalKeystrokes: sql<number>`coalesce(sum(${activitySessions.totalKeystrokes}), 0)::int`,
        totalFileSaves: sql<number>`coalesce(sum(${activitySessions.totalFileSaves}), 0)::int`,
        sessionCount: sql<number>`count(*)::int`,
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
        totalFileSaves: sql<number>`coalesce(sum(${activitySessions.totalFileSaves}), 0)::int`,
        sessionCount: sql<number>`count(*)::int`,
      })
      .from(activitySessions)
      .where(and(...conditions));

    // Aggregate app usage across all sessions in range (for "Top Apps" chart)
    const appUsageRows = await db
      .select({ appUsage: activitySessions.appUsage })
      .from(activitySessions)
      .where(and(...conditions));
    const appTotals: Record<string, number> = {};
    for (const row of appUsageRows) {
      const map = (row.appUsage || {}) as Record<string, number>;
      for (const [appName, secs] of Object.entries(map)) {
        if (typeof secs !== "number" || !appName) continue;
        appTotals[appName] = (appTotals[appName] || 0) + secs;
      }
    }
    const topApps = Object.entries(appTotals)
      .map(([name, seconds]) => ({ name, seconds }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 10);

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
      topApps,
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
        totalFileSaves: sql<number>`coalesce(sum(${activitySessions.totalFileSaves}), 0)::int`,
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

  // AI usage breakdown by date (for the AI Usage & Cost page)
  app.get("/api/admin/ai-usage/daily", { preHandler: admin }, async (request, reply) => {
    const query = dateRangeSchema.parse(request.query);

    const conditions = [];
    if (query.from) conditions.push(gte(aiUsageDaily.date, query.from.slice(0, 10)));
    if (query.to) conditions.push(lte(aiUsageDaily.date, query.to.slice(0, 10)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const daily = await db
      .select({
        date: aiUsageDaily.date,
        totalRequests: sql<number>`coalesce(sum(${aiUsageDaily.totalRequests}), 0)::int`,
        totalInputTokens: sql<number>`coalesce(sum(${aiUsageDaily.totalInputTokens}), 0)::int`,
        totalOutputTokens: sql<number>`coalesce(sum(${aiUsageDaily.totalOutputTokens}), 0)::int`,
        totalCostUsd: sql<string>`coalesce(sum(${aiUsageDaily.totalCostUsd}), 0)`,
        uniqueUsers: sql<number>`count(distinct ${aiUsageDaily.userId})::int`,
      })
      .from(aiUsageDaily)
      .where(whereClause)
      .groupBy(aiUsageDaily.date)
      .orderBy(desc(aiUsageDaily.date))
      .limit(query.limit);

    return reply.send({ data: daily });
  });

  // List all users (admin)
  app.get("/api/admin/users", { preHandler: admin }, async (request, reply) => {
    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        team: users.team,
        avatarUrl: users.avatarUrl,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    return reply.send({ data: allUsers });
  });

  // ─── Manager: my team members ───
  app.get("/api/my-team", { preHandler: requireManager(authService) }, async (request, reply) => {
    const query = dateRangeSchema.parse(request.query);

    // Find the manager's name to match against employee_directory
    const [me] = await db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, request.user.sub))
      .limit(1);

    if (!me) return reply.send({ data: [] });

    // Find team members: users whose team matches this manager, OR
    // from employee_directory where manager = this user's name
    const conditions = [];
    if (query.from) conditions.push(gte(activitySessions.startedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(activitySessions.startedAt, new Date(query.to)));

    // Get all users on this manager's team
    const teamMembers = await db
      .select({
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        team: users.team,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.team, me.fullName))
      .orderBy(users.fullName);

    // For each team member, get activity stats
    const enriched = await Promise.all(
      teamMembers.map(async (member) => {
        const memberConditions = [eq(activitySessions.userId, member.userId)];
        if (query.from) memberConditions.push(gte(activitySessions.startedAt, new Date(query.from)));
        if (query.to) memberConditions.push(lte(activitySessions.startedAt, new Date(query.to)));

        const [stats] = await db
          .select({
            totalActiveSeconds: sql<number>`coalesce(sum(${activitySessions.activeSeconds}), 0)::int`,
            totalIdleSeconds: sql<number>`coalesce(sum(${activitySessions.idleSeconds}), 0)::int`,
            totalKeystrokes: sql<number>`coalesce(sum(${activitySessions.totalKeystrokes}), 0)::int`,
            sessionCount: sql<number>`count(*)::int`,
            lastActive: sql<string>`max(${activitySessions.startedAt})`,
          })
          .from(activitySessions)
          .where(and(...memberConditions));

        return { ...member, ...stats };
      })
    );

    return reply.send({ data: enriched });
  });

  // ─── Admin: manual time entry ───
  app.post("/api/admin/activity/manual-entry", { preHandler: admin }, async (request, reply) => {
    const body = z.object({
      userId: z.string().uuid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      activeSeconds: z.number().int().min(0).max(86400),
      note: z.string().max(500).optional(),
      externalProjectId: z.string().optional(),
      externalTaskId: z.string().optional(),
    }).parse(request.body);

    try {
      // Create a manual session entry
      const startedAt = new Date(`${body.date}T09:00:00.000Z`);
      const endedAt = new Date(startedAt.getTime() + body.activeSeconds * 1000);

      const [session] = await db
        .insert(activitySessions)
        .values({
          userId: body.userId,
          startedAt,
          endedAt,
          activeSeconds: body.activeSeconds,
          idleSeconds: 0,
          totalKeystrokes: 0,
          totalFileSaves: 0,
          totalFileChanges: 0,
          filesTouched: {},
          languagesUsed: {},
          editorVersion: "manual-entry",
          extensionVersion: "admin",
          osPlatform: "manual",
        })
        .returning({ id: activitySessions.id });

      // Create a blank screenshot to mark it as manual entry
      await db.insert(screenshots).values({
        userId: body.userId,
        sessionId: session.id,
        filename: "manual-entry.png",
        storagePath: "",
        imageData: null,
        fileSizeBytes: 0,
        metadata: {
          manualEntry: true,
          addedBy: request.user.sub,
          addedByEmail: request.user.email,
          note: body.note || "Manually added by admin",
        },
        capturedAt: startedAt,
      });

      console.log(`[Activity] Manual entry: ${body.activeSeconds}s for user ${body.userId} on ${body.date} by admin ${request.user.email}`);

      return reply.send({
        ok: true,
        sessionId: session.id,
        activeSeconds: body.activeSeconds,
        date: body.date,
      });
    } catch (err) {
      console.error("[Activity] Manual entry failed:", err);
      return reply.status(500).send({ error: "Failed to create manual entry", message: String(err) });
    }
  });

  // ─── Team Snapshot (pivoted timesheet grid) ───
  // See TEAM_SNAPSHOT_SPEC.md for the design behind this endpoint.
  app.get("/api/team-snapshot", { preHandler: requireManager(authService) }, async (request, reply) => {
    const query = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(request.query);

    const isAdmin = request.user.role === "admin" || request.user.role === "super_admin";

    // Resolve current user's fullName so managers can be filtered to their own team
    const [me] = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, request.user.sub))
      .limit(1);
    if (!me) return reply.status(404).send({ error: "User not found" });

    // Build the date column list: from..to inclusive, today excluded, newest first
    const todayStr = new Date().toISOString().slice(0, 10);
    const dates: string[] = [];
    {
      const start = new Date(`${query.from}T00:00:00Z`);
      const end = new Date(`${query.to}T00:00:00Z`);
      for (let d = new Date(end); d >= start; d.setUTCDate(d.getUTCDate() - 1)) {
        const s = d.toISOString().slice(0, 10);
        if (s === todayStr) continue;
        dates.push(s);
      }
    }
    if (dates.length === 0) return reply.send({ dates, groups: [] });

    const workingDays = dates.filter((d) => {
      const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
      return wd !== 0 && wd !== 6; // Sun=0, Sat=6
    }).length;

    // Pull every user the viewer is allowed to see, plus per-day session totals
    const userRows = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        team: users.team,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.isActive, true));

    // For managers: only show users whose team matches their fullName.
    // Admins see everyone. We always include the viewer themselves so the grid
    // is never empty.
    const visibleUsers = isAdmin
      ? userRows
      : userRows.filter((u) => u.team === me.fullName || u.id === me.id);

    if (visibleUsers.length === 0) return reply.send({ dates, groups: [] });

    const visibleIds = visibleUsers.map((u) => u.id);

    // Aggregate active_seconds per (user, day) and detect "all-manual" users
    const fromTs = `${query.from}T00:00:00Z`;
    // 'to' is inclusive — bump to end of that day so 23:59 sessions count
    const toTs = `${query.to}T23:59:59Z`;

    type AggRow = {
      userId: string;
      day: string;
      activeSeconds: number;
      autoCount: number;   // sessions where editor_version != 'manual-entry'
      manualCount: number; // sessions where editor_version == 'manual-entry'
    };

    const agg = await db.execute<AggRow>(sql`
      SELECT
        s.user_id::text AS "userId",
        to_char(s.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "day",
        COALESCE(SUM(s.active_seconds), 0)::int AS "activeSeconds",
        COUNT(*) FILTER (WHERE s.editor_version IS DISTINCT FROM 'manual-entry')::int AS "autoCount",
        COUNT(*) FILTER (WHERE s.editor_version = 'manual-entry')::int AS "manualCount"
      FROM activity_sessions s
      WHERE s.user_id = ANY(${visibleIds}::uuid[])
        AND s.started_at >= ${fromTs}::timestamptz
        AND s.started_at <= ${toTs}::timestamptz
      GROUP BY s.user_id, day
    `);

    // Index aggregate rows by userId then day
    const byUser = new Map<string, Map<string, AggRow>>();
    const userTotals = new Map<string, { active: number; auto: number; manual: number }>();
    for (const row of agg as unknown as AggRow[]) {
      let perDay = byUser.get(row.userId);
      if (!perDay) { perDay = new Map(); byUser.set(row.userId, perDay); }
      perDay.set(row.day, row);
      const totals = userTotals.get(row.userId) || { active: 0, auto: 0, manual: 0 };
      totals.active += row.activeSeconds;
      totals.auto += row.autoCount;
      totals.manual += row.manualCount;
      userTotals.set(row.userId, totals);
    }

    // Bucket users into manager groups. Manager identity = users.team value.
    // Anyone whose team is null/empty goes into "Unassigned".
    const groupBuckets = new Map<string, typeof visibleUsers>();
    for (const u of visibleUsers) {
      const key = u.team && u.team.trim() !== "" ? u.team : "Unassigned";
      const bucket = groupBuckets.get(key) || [];
      bucket.push(u);
      groupBuckets.set(key, bucket);
    }

    // Build the response groups
    const groups = Array.from(groupBuckets.entries()).map(([managerName, members]) => {
      const employees = members.map((u) => {
        const perDayRows = byUser.get(u.id);
        const totals = userTotals.get(u.id) || { active: 0, auto: 0, manual: 0 };
        const isAllManual = totals.manual > 0 && totals.auto === 0;

        const perDate: Record<string, { activeSeconds: number; kind: "data" | "no-data" | "weekend" }> = {};
        for (const d of dates) {
          const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
          const isWeekend = wd === 0 || wd === 6;
          const row = perDayRows?.get(d);
          if (isWeekend) {
            perDate[d] = { activeSeconds: 0, kind: "weekend" };
          } else if (row && row.activeSeconds > 0) {
            perDate[d] = { activeSeconds: row.activeSeconds, kind: "data" };
          } else {
            perDate[d] = { activeSeconds: 0, kind: "no-data" };
          }
        }

        const atdSeconds = workingDays > 0 ? Math.round(totals.active / workingDays) : 0;
        return {
          userId: u.id,
          fullName: u.fullName,
          email: u.email,
          atdSeconds,
          isAllManual,
          perDate,
        };
      });

      // Group-level aggregates: average across employees per date
      const perDateTeamAvgSeconds: Record<string, number> = {};
      for (const d of dates) {
        const sum = employees.reduce((acc, e) => acc + (e.perDate[d]?.activeSeconds || 0), 0);
        perDateTeamAvgSeconds[d] = employees.length > 0 ? Math.round(sum / employees.length) : 0;
      }
      const teamTotalSeconds = employees.reduce((acc, e) => acc + Object.values(e.perDate).reduce((a, c) => a + c.activeSeconds, 0), 0);
      const headerAtdSeconds = (workingDays > 0 && employees.length > 0)
        ? Math.round(teamTotalSeconds / (employees.length * workingDays))
        : 0;
      const expectedHours = 8 * employees.length * workingDays;
      const teamBandwidthPct = expectedHours > 0 ? Math.round((teamTotalSeconds / 3600 / expectedHours) * 1000) / 10 : 0;

      return {
        managerId: null as string | null,
        managerName,
        headerAtdSeconds,
        teamBandwidthPct,
        perDateTeamAvgSeconds,
        employees,
      };
    });

    // Sort groups: known manager names alphabetically, "Unassigned" last
    groups.sort((a, b) => {
      if (a.managerName === "Unassigned") return 1;
      if (b.managerName === "Unassigned") return -1;
      return a.managerName.localeCompare(b.managerName);
    });

    return reply.send({ dates, groups });
  });
}
