import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, gte, lte, desc, sql, asc } from "drizzle-orm";
import { requireAuth, requireAdmin, requireManager } from "../middleware/requireAuth.js";
import type { AuthService } from "../services/AuthService.js";
import type { Database } from "../config/database.js";
import { activitySessions, users, aiUsageDaily, screenshots, holidays, leaveDays } from "../models/index.js";
import { inArray } from "drizzle-orm";

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
        employmentStatus: users.employmentStatus,
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
      // Optional admin-only filter: limit to one manager group
      managerName: z.string().optional(),
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

    // Pull holidays in the date range so working-day counts can subtract them
    const holidayRows = await db
      .select({ date: holidays.date, name: holidays.name })
      .from(holidays)
      .where(and(
        gte(holidays.date, query.from),
        lte(holidays.date, query.to),
      ));
    const holidayMap = new Map<string, string>();
    for (const h of holidayRows) holidayMap.set(h.date as unknown as string, h.name);

    const workingDays = dates.filter((d) => {
      const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (wd === 0 || wd === 6) return false; // Sun=0, Sat=6
      if (holidayMap.has(d)) return false;     // Company holiday
      return true;
    }).length;

    // Pull leave days for everyone we'll show, in the date range
    // (loaded after we resolve visibleUsers below — see further down)

    // Pull every user the viewer is allowed to see, plus per-day session totals
    const userRows = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        team: users.team,
        role: users.role,
        isActive: users.isActive,
        employmentStatus: users.employmentStatus,
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

    // Pull this group's leave days inside the range
    const leaveRows = await db
      .select({
        userId: leaveDays.userId,
        date: leaveDays.date,
        leaveType: leaveDays.leaveType,
        note: leaveDays.note,
      })
      .from(leaveDays)
      .where(and(
        inArray(leaveDays.userId, visibleIds),
        gte(leaveDays.date, query.from),
        lte(leaveDays.date, query.to),
      ));
    const leavesByUser = new Map<string, Map<string, { type: string; note: string | null }>>();
    for (const r of leaveRows) {
      let m = leavesByUser.get(r.userId);
      if (!m) { m = new Map(); leavesByUser.set(r.userId, m); }
      m.set(r.date as unknown as string, { type: r.leaveType, note: r.note });
    }

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
      // Admin-only filter: skip groups that don't match the requested manager
      if (isAdmin && query.managerName && key !== query.managerName) continue;
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

        const userLeaves = leavesByUser.get(u.id);
        let userLeaveDayUnits = 0; // 1.0 per full leave, 0.5 per half-day
        const perDate: Record<string, { activeSeconds: number; kind: "data" | "no-data" | "weekend" | "holiday" | "leave"; label?: string }> = {};
        for (const d of dates) {
          const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
          const isWeekend = wd === 0 || wd === 6;
          const holidayName = holidayMap.get(d);
          const leave = userLeaves?.get(d);
          const row = perDayRows?.get(d);
          if (isWeekend) {
            perDate[d] = { activeSeconds: 0, kind: "weekend" };
          } else if (holidayName) {
            perDate[d] = { activeSeconds: row?.activeSeconds ?? 0, kind: "holiday", label: holidayName };
          } else if (leave) {
            const isHalf = leave.type === "half";
            userLeaveDayUnits += isHalf ? 0.5 : 1;
            const labelMap: Record<string, string> = {
              full: "Leave", half: "Half day", sick: "Sick leave",
              paid: "Paid leave", unpaid: "Unpaid leave",
            };
            perDate[d] = {
              activeSeconds: row?.activeSeconds ?? 0,
              kind: "leave",
              label: leave.note ? `${labelMap[leave.type] ?? leave.type} — ${leave.note}` : (labelMap[leave.type] ?? leave.type),
            };
          } else if (row && row.activeSeconds > 0) {
            perDate[d] = { activeSeconds: row.activeSeconds, kind: "data" };
          } else {
            perDate[d] = { activeSeconds: 0, kind: "no-data" };
          }
        }

        // ATD denominator excludes this user's leave days (half = 0.5)
        const userWorkingDays = Math.max(0, workingDays - userLeaveDayUnits);
        const atdSeconds = userWorkingDays > 0 ? Math.round(totals.active / userWorkingDays) : 0;
        return {
          userId: u.id,
          fullName: u.fullName,
          email: u.email,
          atdSeconds,
          isAllManual,
          employmentStatus: u.employmentStatus,
          perDate,
        };
      });

      // Group-level aggregates: average across employees per date
      // Only "active" employees count toward team aggregates / TB%. Resigned,
      // on-leave, notice, etc. still appear as rows but don't tank the manager's
      // utilization metric or pull down the team-average row.
      const activeEmployees = employees.filter((e) => e.employmentStatus === "active");
      const denomCount = activeEmployees.length;

      const perDateTeamAvgSeconds: Record<string, number> = {};
      for (const d of dates) {
        const sum = activeEmployees.reduce((acc, e) => acc + (e.perDate[d]?.activeSeconds || 0), 0);
        perDateTeamAvgSeconds[d] = denomCount > 0 ? Math.round(sum / denomCount) : 0;
      }
      const teamTotalSeconds = activeEmployees.reduce((acc, e) => acc + Object.values(e.perDate).reduce((a, c) => a + c.activeSeconds, 0), 0);
      const headerAtdSeconds = (workingDays > 0 && denomCount > 0)
        ? Math.round(teamTotalSeconds / (denomCount * workingDays))
        : 0;
      const expectedHours = 8 * denomCount * workingDays;
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

  // Helper: load holiday dates in [from, to] and return as a Set of YYYY-MM-DD
  async function loadHolidaySet(from: string, to: string): Promise<Set<string>> {
    const rows = await db
      .select({ date: holidays.date })
      .from(holidays)
      .where(and(gte(holidays.date, from), lte(holidays.date, to)));
    return new Set(rows.map((r) => r.date as unknown as string));
  }

  // ─── Bandwidth report (per-manager utilization for an arbitrary range) ───
  app.get("/api/team-snapshot/bandwidth", { preHandler: requireManager(authService) }, async (request, reply) => {
    const query = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(request.query);

    const isAdmin = request.user.role === "admin" || request.user.role === "super_admin";
    const [me] = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, request.user.sub))
      .limit(1);
    if (!me) return reply.status(404).send({ error: "User not found" });

    // Build working-day count for the range, subtracting weekends and holidays
    const holidaySet = await loadHolidaySet(query.from, query.to);
    const start = new Date(`${query.from}T00:00:00Z`);
    const end = new Date(`${query.to}T00:00:00Z`);
    let workingDays = 0;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const wd = d.getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const iso = d.toISOString().slice(0, 10);
      if (holidaySet.has(iso)) continue;
      workingDays += 1;
    }

    // Pull active employees only — resigned / on_leave / notice etc. don't
    // contribute to expected-vs-actual team capacity math
    const allUsers = await db
      .select({ id: users.id, fullName: users.fullName, team: users.team, employmentStatus: users.employmentStatus })
      .from(users)
      .where(and(eq(users.isActive, true), eq(users.employmentStatus, "active")));
    const visibleUsers = isAdmin
      ? allUsers
      : allUsers.filter((u) => u.team === me.fullName || u.id === me.id);
    if (visibleUsers.length === 0) return reply.send({ workingDays, rows: [] });

    const visibleIds = visibleUsers.map((u) => u.id);
    const fromTs = `${query.from}T00:00:00Z`;
    const toTs = `${query.to}T23:59:59Z`;

    const totals = await db.execute<{ userId: string; activeSeconds: number }>(sql`
      SELECT s.user_id::text AS "userId",
             COALESCE(SUM(s.active_seconds), 0)::int AS "activeSeconds"
      FROM activity_sessions s
      WHERE s.user_id = ANY(${visibleIds}::uuid[])
        AND s.started_at >= ${fromTs}::timestamptz
        AND s.started_at <= ${toTs}::timestamptz
      GROUP BY s.user_id
    `);
    const totalsByUser = new Map<string, number>();
    for (const r of totals as unknown as Array<{ userId: string; activeSeconds: number }>) {
      totalsByUser.set(r.userId, r.activeSeconds);
    }

    // Bucket by team and aggregate
    const byTeam = new Map<string, { teamSize: number; activeSeconds: number }>();
    for (const u of visibleUsers) {
      const key = u.team && u.team.trim() !== "" ? u.team : "Unassigned";
      const cur = byTeam.get(key) || { teamSize: 0, activeSeconds: 0 };
      cur.teamSize += 1;
      cur.activeSeconds += totalsByUser.get(u.id) || 0;
      byTeam.set(key, cur);
    }

    const rows = Array.from(byTeam.entries()).map(([managerName, agg]) => {
      const expectedHours = 8 * agg.teamSize * workingDays;
      const actualHours = Math.round((agg.activeSeconds / 3600) * 10) / 10;
      const occupiedPct = expectedHours > 0 ? Math.round((actualHours / expectedHours) * 1000) / 10 : 0;
      return {
        managerName,
        teamSize: agg.teamSize,
        workingDays,
        expectedHours,
        actualHours,
        occupiedPct,
        freePct: Math.max(0, Math.round((100 - occupiedPct) * 10) / 10),
      };
    });
    rows.sort((a, b) => a.managerName.localeCompare(b.managerName));
    return reply.send({ workingDays, rows });
  });

  // ─── Summary report (org-wide stats + Good/Moderate/Low distribution) ───
  app.get("/api/team-snapshot/summary", { preHandler: requireManager(authService) }, async (request, reply) => {
    const query = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(request.query);

    const isAdmin = request.user.role === "admin" || request.user.role === "super_admin";
    const [me] = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, request.user.sub))
      .limit(1);
    if (!me) return reply.status(404).send({ error: "User not found" });

    // Working-day count, subtracting weekends and holidays
    const summaryHolidaySet = await loadHolidaySet(query.from, query.to);
    const start = new Date(`${query.from}T00:00:00Z`);
    const end = new Date(`${query.to}T00:00:00Z`);
    let workingDays = 0;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const wd = d.getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const iso = d.toISOString().slice(0, 10);
      if (summaryHolidaySet.has(iso)) continue;
      workingDays += 1;
    }

    // Org-wide KPIs: only count active employees. Resigned / on_leave /
    // notice / maternity get excluded so the metrics reflect productive capacity.
    const allUsers = await db
      .select({ id: users.id, fullName: users.fullName, team: users.team })
      .from(users)
      .where(and(eq(users.isActive, true), eq(users.employmentStatus, "active")));
    const visibleUsers = isAdmin
      ? allUsers
      : allUsers.filter((u) => u.team === me.fullName || u.id === me.id);
    const visibleIds = visibleUsers.map((u) => u.id);

    if (visibleUsers.length === 0) {
      return reply.send({
        totalActiveEmployees: 0,
        workingDays,
        avgHoursPerEmployeePerDay: 0,
        distribution: { good: 0, moderate: 0, low: 0, none: 0 },
      });
    }

    const fromTs = `${query.from}T00:00:00Z`;
    const toTs = `${query.to}T23:59:59Z`;

    // Per-(user, day) totals so we can bucket each working day for each employee
    const perDay = await db.execute<{ userId: string; day: string; activeSeconds: number }>(sql`
      SELECT s.user_id::text AS "userId",
             to_char(s.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "day",
             COALESCE(SUM(s.active_seconds), 0)::int AS "activeSeconds"
      FROM activity_sessions s
      WHERE s.user_id = ANY(${visibleIds}::uuid[])
        AND s.started_at >= ${fromTs}::timestamptz
        AND s.started_at <= ${toTs}::timestamptz
      GROUP BY s.user_id, day
    `);

    const cellByUserDay = new Map<string, number>();
    let totalActiveSeconds = 0;
    for (const r of perDay as unknown as Array<{ userId: string; day: string; activeSeconds: number }>) {
      cellByUserDay.set(`${r.userId}|${r.day}`, r.activeSeconds);
      totalActiveSeconds += r.activeSeconds;
    }

    // Load leaves for the visible users so we can skip those cells from the
    // distribution (a person on PTO shouldn't count as "Low <4h").
    const leaveRows = visibleIds.length > 0
      ? await db
          .select({ userId: leaveDays.userId, date: leaveDays.date })
          .from(leaveDays)
          .where(and(
            inArray(leaveDays.userId, visibleIds),
            gte(leaveDays.date, query.from),
            lte(leaveDays.date, query.to),
          ))
      : [];
    const leaveSet = new Set(leaveRows.map((r) => `${r.userId}|${r.date}`));

    // Walk every (user × working-day) cell and bucket — skip weekends + holidays + leave
    const distribution = { good: 0, moderate: 0, low: 0, none: 0 };
    for (const u of visibleUsers) {
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const wd = d.getUTCDay();
        if (wd === 0 || wd === 6) continue;
        const day = d.toISOString().slice(0, 10);
        if (summaryHolidaySet.has(day)) continue;
        if (leaveSet.has(`${u.id}|${day}`)) continue;
        const seconds = cellByUserDay.get(`${u.id}|${day}`) || 0;
        const hours = seconds / 3600;
        if (seconds === 0) distribution.none += 1;
        else if (hours >= 7) distribution.good += 1;
        else if (hours >= 4) distribution.moderate += 1;
        else distribution.low += 1;
      }
    }

    const totalEmployeeDays = visibleUsers.length * workingDays;
    const avgHoursPerEmployeePerDay = totalEmployeeDays > 0
      ? Math.round((totalActiveSeconds / 3600 / totalEmployeeDays) * 10) / 10
      : 0;

    return reply.send({
      totalActiveEmployees: visibleUsers.length,
      workingDays,
      avgHoursPerEmployeePerDay,
      distribution,
    });
  });

  // ─── Holidays CRUD ───
  // List holidays — visible to anyone authenticated, since the snapshot/grid
  // pages will eventually want to show the names too.
  app.get("/api/holidays", { preHandler: auth }, async (request, reply) => {
    const q = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(request.query);
    const conditions = [];
    if (q.from) conditions.push(gte(holidays.date, q.from));
    if (q.to) conditions.push(lte(holidays.date, q.to));
    const rows = await db
      .select({ id: holidays.id, date: holidays.date, name: holidays.name })
      .from(holidays)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(holidays.date));
    return reply.send({ data: rows });
  });

  // Add a holiday — admin only
  app.post("/api/admin/holidays", { preHandler: admin }, async (request, reply) => {
    const body = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      name: z.string().min(1).max(100),
    }).parse(request.body);
    try {
      const [row] = await db
        .insert(holidays)
        .values({ date: body.date, name: body.name })
        .returning();
      return reply.status(201).send(row);
    } catch (err) {
      // Most likely unique-violation on date
      return reply.status(409).send({
        error: "Conflict",
        message: `A holiday is already set for ${body.date}`,
      });
    }
  });

  // Delete a holiday — admin only
  app.delete("/api/admin/holidays/:id", { preHandler: admin }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await db.delete(holidays).where(eq(holidays.id, id));
    return reply.send({ ok: true });
  });

  // ─── Leave days CRUD ───
  // List leaves. Admins see everyone; managers see only their team members.
  app.get("/api/leaves", { preHandler: requireManager(authService) }, async (request, reply) => {
    const q = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      userId: z.string().uuid().optional(),
    }).parse(request.query);

    const isAdmin = request.user.role === "admin" || request.user.role === "super_admin";
    const [me] = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, request.user.sub))
      .limit(1);
    if (!me) return reply.status(404).send({ error: "User not found" });

    // Resolve which user IDs the caller can see
    let visibleIds: string[];
    if (isAdmin) {
      visibleIds = []; // sentinel: "no filter, see all" — handled below
    } else {
      const team = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.team, me.fullName));
      visibleIds = [me.id, ...team.map((t) => t.id)];
    }

    const conditions = [];
    if (q.from) conditions.push(gte(leaveDays.date, q.from));
    if (q.to) conditions.push(lte(leaveDays.date, q.to));
    if (q.userId) conditions.push(eq(leaveDays.userId, q.userId));
    if (!isAdmin) conditions.push(inArray(leaveDays.userId, visibleIds));

    const rows = await db
      .select({
        id: leaveDays.id,
        userId: leaveDays.userId,
        userFullName: users.fullName,
        userEmail: users.email,
        date: leaveDays.date,
        leaveType: leaveDays.leaveType,
        note: leaveDays.note,
        createdAt: leaveDays.createdAt,
      })
      .from(leaveDays)
      .leftJoin(users, eq(users.id, leaveDays.userId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(leaveDays.date));

    return reply.send({ data: rows });
  });

  // Add leave for a user (single date, or expand a range client-side and call repeatedly)
  app.post("/api/admin/leaves", { preHandler: admin }, async (request, reply) => {
    const body = z.object({
      userId: z.string().uuid(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      leaveType: z.enum(["full", "half", "sick", "paid", "unpaid"]).default("full"),
      note: z.string().max(500).optional(),
    }).parse(request.body);

    // Build the list of dates inclusive (caps at 31 to prevent runaway inserts)
    const fromDate = new Date(`${body.from}T00:00:00Z`);
    const toDate = new Date(`${body.to ?? body.from}T00:00:00Z`);
    if (toDate < fromDate) return reply.status(400).send({ error: "to is before from" });
    const dateList: string[] = [];
    for (let d = new Date(fromDate); d <= toDate && dateList.length < 31; d.setUTCDate(d.getUTCDate() + 1)) {
      const wd = d.getUTCDay();
      if (wd === 0 || wd === 6) continue; // skip weekends; no point storing
      dateList.push(d.toISOString().slice(0, 10));
    }
    if (dateList.length === 0) {
      return reply.send({ data: [], skipped: 0, note: "Range only contained weekends." });
    }

    // Insert with onConflict=doNothing so re-adding doesn't blow up
    const inserted = await db
      .insert(leaveDays)
      .values(dateList.map((date) => ({
        userId: body.userId,
        date,
        leaveType: body.leaveType,
        note: body.note ?? null,
        approvedBy: request.user.sub,
      })))
      .onConflictDoNothing({ target: [leaveDays.userId, leaveDays.date] })
      .returning();

    return reply.status(201).send({
      data: inserted,
      skipped: dateList.length - inserted.length,
    });
  });

  // Delete a leave entry — admin only
  app.delete("/api/admin/leaves/:id", { preHandler: admin }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await db.delete(leaveDays).where(eq(leaveDays.id, id));
    return reply.send({ ok: true });
  });
}
