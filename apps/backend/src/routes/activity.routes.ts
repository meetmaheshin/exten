import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, gte, lte, desc, sql, asc, isNull } from "drizzle-orm";
import { requireAuth, requireAdmin, requireManager, requireSuperAdmin } from "../middleware/requireAuth.js";
import type { AuthService } from "../services/AuthService.js";
import type { Database } from "../config/database.js";
import { activitySessions, users, aiUsageDaily, screenshots, holidays, leaveDays, employeeDirectory } from "../models/index.js";
import { inArray } from "drizzle-orm";

// Payroll source of truth: each live (non-deleted) screenshot is worth this
// many seconds of billable time. Mirrors the capture interval that
// ScreenCaptureService runs at on the client. Changing this changes how much
// pay a single screenshot represents — coordinate with HR before touching it.
const BILLABLE_SECONDS_PER_SCREENSHOT = 300;

/**
 * Return the lowercased emails of every employee in the directory. When the
 * directory has any rows, Team Snapshot / Bandwidth / Summary should restrict
 * their user lists to people whose email is in this set — otherwise we'd be
 * showing seed/test users (Bob Smith, Alice Johnson, etc.) that no admin ever
 * imported. Returns null when the directory is empty so the caller falls back
 * to "show everyone in users".
 */
async function loadDirectoryEmailSet(db: Database): Promise<Set<string> | null> {
  const rows = await db.select({ email: employeeDirectory.email }).from(employeeDirectory);
  if (rows.length === 0) return null;
  return new Set(rows.map((r) => (r.email || "").trim().toLowerCase()).filter((e) => e.length > 0));
}

/**
 * Compute active-seconds-per-(user, day) from the screenshot table.
 *
 * This is the PAYROLL number for every active-time field in the API.
 *   active_seconds = count(live screenshots in that user's day) × 300
 *
 * It replaces sum(activity_sessions.active_seconds) everywhere, because
 * that sum inflated whenever a heartbeat landed without a matching
 * screenshot (lock screen, capture failure, network drop). Under the new
 * model: no screenshot, no pay for that 5-min slot. Simple and honest.
 *
 * Capped at 86400 per (user, day) to defend against weird upload backlogs.
 *
 * Returns a Map keyed by `${userId}|${YYYY-MM-DD}` → seconds. Lookup is
 * cheap; missing keys mean "no screenshots that day" → caller should
 * default to 0.
 *
 * If `userIds` is undefined the helper aggregates across every user in
 * the date range (used by org-wide admin queries).
 */
async function loadActiveSecondsByUserDay(
  db: Database,
  opts: { userIds?: string[]; from?: Date; to?: Date },
): Promise<Map<string, number>> {
  const conditions = [isNull(screenshots.deletedAt)];
  if (opts.userIds && opts.userIds.length > 0) {
    conditions.push(inArray(screenshots.userId, opts.userIds));
  }
  if (opts.from) conditions.push(gte(screenshots.capturedAt, opts.from));
  if (opts.to) conditions.push(lte(screenshots.capturedAt, opts.to));

  const rows = await db
    .select({
      userId: screenshots.userId,
      day: sql<string>`to_char(${screenshots.capturedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      ssCount: sql<number>`count(*)::int`,
    })
    .from(screenshots)
    .where(and(...conditions))
    .groupBy(screenshots.userId, sql`to_char(${screenshots.capturedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`);

  const out = new Map<string, number>();
  for (const r of rows) {
    const seconds = Math.min(r.ssCount * BILLABLE_SECONDS_PER_SCREENSHOT, 86400);
    out.set(`${r.userId}|${r.day}`, seconds);
  }
  return out;
}

/**
 * Same as loadActiveSecondsByUserDay but pre-summed per user (drops the
 * per-day grouping). Used by endpoints that only need totals over a range.
 */
async function loadActiveSecondsByUser(
  db: Database,
  opts: { userIds?: string[]; from?: Date; to?: Date },
): Promise<Map<string, number>> {
  const perDay = await loadActiveSecondsByUserDay(db, opts);
  const out = new Map<string, number>();
  for (const [key, secs] of perDay) {
    const userId = key.split("|")[0];
    out.set(userId, (out.get(userId) ?? 0) + secs);
  }
  return out;
}

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

    // Explicit column list — using db.select() with no projection returns *every*
    // model column, which 500s when the DB is on an older schema (e.g. project_name
    // hasn't been migrated yet). Listing columns by hand keeps this robust.
    const sessions = await db
      .select({
        id: activitySessions.id,
        startedAt: activitySessions.startedAt,
        endedAt: activitySessions.endedAt,
        activeSeconds: activitySessions.activeSeconds,
        idleSeconds: activitySessions.idleSeconds,
        totalKeystrokes: activitySessions.totalKeystrokes,
        totalFileSaves: activitySessions.totalFileSaves,
        totalFileChanges: activitySessions.totalFileChanges,
        editorVersion: activitySessions.editorVersion,
        extensionVersion: activitySessions.extensionVersion,
        osPlatform: activitySessions.osPlatform,
      })
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

    // Active time is screenshot-derived; idle + diagnostic counters still
    // come from activity_sessions. See loadActiveSecondsByUserDay for why.
    const activeByUser = await loadActiveSecondsByUser(db, {
      userIds: [request.user.sub],
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
    const totalActiveSeconds = activeByUser.get(request.user.sub) ?? 0;

    const [other] = await db
      .select({
        totalSessions: sql<number>`count(*)::int`,
        totalIdleSeconds: sql<number>`coalesce(sum(least(${activitySessions.idleSeconds}, 86400)), 0)::int`,
        totalKeystrokes: sql<number>`coalesce(sum(${activitySessions.totalKeystrokes}), 0)::int`,
        totalFileSaves: sql<number>`coalesce(sum(${activitySessions.totalFileSaves}), 0)::int`,
        totalFileChanges: sql<number>`coalesce(sum(${activitySessions.totalFileChanges}), 0)::int`,
      })
      .from(activitySessions)
      .where(and(...conditions));

    return reply.send({ data: { ...other, totalActiveSeconds } });
  });

  // Get my daily activity breakdown
  app.get("/api/activity/me/daily", { preHandler: auth }, async (request, reply) => {
    const query = dateRangeSchema.parse(request.query);

    const conditions = [eq(activitySessions.userId, request.user.sub)];
    if (query.from) conditions.push(gte(activitySessions.startedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(activitySessions.startedAt, new Date(query.to)));

    // Idle + diagnostic stats per day, sourced from activity_sessions.
    // Active seconds are NOT pulled here — they come from the screenshot
    // count below and override whatever sum(active_seconds) would produce.
    const daily = await db
      .select({
        date: sql<string>`date(${activitySessions.startedAt})`,
        totalIdleSeconds: sql<number>`coalesce(sum(least(${activitySessions.idleSeconds}, 86400)), 0)::int`,
        totalKeystrokes: sql<number>`coalesce(sum(${activitySessions.totalKeystrokes}), 0)::int`,
        totalFileSaves: sql<number>`coalesce(sum(${activitySessions.totalFileSaves}), 0)::int`,
        sessionCount: sql<number>`count(*)::int`,
      })
      .from(activitySessions)
      .where(and(...conditions))
      .groupBy(sql`date(${activitySessions.startedAt})`)
      .orderBy(asc(sql`date(${activitySessions.startedAt})`))
      .limit(query.limit);

    // totalActiveSeconds per day — screenshot-derived via the shared helper.
    // Sessions with no screenshots that day contribute 0 (no proof = no pay).
    // Days that have screenshots but no session row get a synthetic row.
    const activeByUserDay = await loadActiveSecondsByUserDay(db, {
      userIds: [request.user.sub],
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
    const activeByDate = new Map<string, number>();
    for (const [key, secs] of activeByUserDay) {
      activeByDate.set(key.split("|")[1], secs);
    }

    const merged = daily.map((d) => ({
      ...d,
      totalActiveSeconds: activeByDate.get(d.date) ?? 0,
    }));
    const seenDates = new Set(daily.map((d) => d.date));
    for (const [date, activeSeconds] of activeByDate) {
      if (!seenDates.has(date)) {
        merged.push({
          date,
          totalIdleSeconds: 0,
          totalKeystrokes: 0,
          totalFileSaves: 0,
          sessionCount: 0,
          totalActiveSeconds: activeSeconds,
        });
      }
    }
    merged.sort((a, b) => a.date.localeCompare(b.date));

    return reply.send({ data: merged });
  });

  // ─── Admin: Team-wide activity ───

  // Get overview for all developers
  app.get("/api/admin/activity/overview", { preHandler: admin }, async (request, reply) => {
    const query = dateRangeSchema.parse(request.query);

    const conditions = [];
    if (query.from) conditions.push(gte(activitySessions.startedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(activitySessions.startedAt, new Date(query.to)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Idle + diagnostic counters from activity_sessions; sort + slice in JS
    // after we've merged in the screenshot-derived active seconds.
    const sessionRows = await db
      .select({
        userId: activitySessions.userId,
        email: users.email,
        fullName: users.fullName,
        team: users.team,
        totalIdleSeconds: sql<number>`coalesce(sum(least(${activitySessions.idleSeconds}, 86400)), 0)::int`,
        totalKeystrokes: sql<number>`coalesce(sum(${activitySessions.totalKeystrokes}), 0)::int`,
        totalFileSaves: sql<number>`coalesce(sum(${activitySessions.totalFileSaves}), 0)::int`,
        sessionCount: sql<number>`count(*)::int`,
        lastActive: sql<string>`max(${activitySessions.startedAt})`,
      })
      .from(activitySessions)
      .innerJoin(users, eq(activitySessions.userId, users.id))
      .where(whereClause)
      .groupBy(activitySessions.userId, users.email, users.fullName, users.team);

    const activeByUser = await loadActiveSecondsByUser(db, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });

    const overview = sessionRows
      .map((r) => ({ ...r, totalActiveSeconds: activeByUser.get(r.userId) ?? 0 }))
      .sort((a, b) => b.totalActiveSeconds - a.totalActiveSeconds)
      .slice(query.offset, query.offset + query.limit);

    return reply.send({ data: overview });
  });

  // Get detailed activity for a specific user
  app.get("/api/admin/activity/user/:userId", { preHandler: admin }, async (request, reply) => {
    const { userId } = userIdParam.parse(request.params);
    const query = dateRangeSchema.parse(request.query);

    const conditions = [eq(activitySessions.userId, userId)];
    if (query.from) conditions.push(gte(activitySessions.startedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(activitySessions.startedAt, new Date(query.to)));

    // Explicit column list — see note on /api/activity/me/sessions
    const sessions = await db
      .select({
        id: activitySessions.id,
        startedAt: activitySessions.startedAt,
        endedAt: activitySessions.endedAt,
        activeSeconds: activitySessions.activeSeconds,
        idleSeconds: activitySessions.idleSeconds,
        totalKeystrokes: activitySessions.totalKeystrokes,
        totalFileSaves: activitySessions.totalFileSaves,
        totalFileChanges: activitySessions.totalFileChanges,
        editorVersion: activitySessions.editorVersion,
        extensionVersion: activitySessions.extensionVersion,
        osPlatform: activitySessions.osPlatform,
      })
      .from(activitySessions)
      .where(and(...conditions))
      .orderBy(desc(activitySessions.startedAt))
      .limit(query.limit)
      .offset(query.offset);

    // Also get summary — active from screenshots, idle/saves/sessionCount
    // from activity_sessions.
    const [summaryRaw] = await db
      .select({
        totalIdleSeconds: sql<number>`coalesce(sum(least(${activitySessions.idleSeconds}, 86400)), 0)::int`,
        totalFileSaves: sql<number>`coalesce(sum(${activitySessions.totalFileSaves}), 0)::int`,
        sessionCount: sql<number>`count(*)::int`,
      })
      .from(activitySessions)
      .where(and(...conditions));
    const activeForUser = await loadActiveSecondsByUser(db, {
      userIds: [userId],
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
    const summary = { ...summaryRaw, totalActiveSeconds: activeForUser.get(userId) ?? 0 };

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
        totalIdleSeconds: sql<number>`coalesce(sum(least(${activitySessions.idleSeconds}, 86400)), 0)::int`,
        totalFileSaves: sql<number>`coalesce(sum(${activitySessions.totalFileSaves}), 0)::int`,
        activeDevelopers: sql<number>`count(distinct ${activitySessions.userId})::int`,
        sessionCount: sql<number>`count(*)::int`,
      })
      .from(activitySessions)
      .where(whereClause)
      .groupBy(sql`date(${activitySessions.startedAt})`)
      .orderBy(asc(sql`date(${activitySessions.startedAt})`))
      .limit(query.limit);

    // Sum org-wide active seconds per day from screenshots, then merge.
    const activeByUserDay = await loadActiveSecondsByUserDay(db, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
    const activeByDate = new Map<string, number>();
    for (const [key, secs] of activeByUserDay) {
      const day = key.split("|")[1];
      activeByDate.set(day, (activeByDate.get(day) ?? 0) + secs);
    }
    const dailyWithActive = daily.map((d) => ({
      ...d,
      totalActiveSeconds: activeByDate.get(d.date) ?? 0,
    }));

    return reply.send({ data: dailyWithActive });
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
        screenshotsDisabled: users.screenshotsDisabled,
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

    // Pre-load screenshot-derived active seconds for ALL team members in
    // one query instead of N+1. Idle/diagnostic counters still come per-user
    // from activity_sessions inside the map below.
    const memberIds = teamMembers.map((m) => m.userId);
    const activeByUser = memberIds.length > 0
      ? await loadActiveSecondsByUser(db, {
          userIds: memberIds,
          from: query.from ? new Date(query.from) : undefined,
          to: query.to ? new Date(query.to) : undefined,
        })
      : new Map<string, number>();

    const enriched = await Promise.all(
      teamMembers.map(async (member) => {
        const memberConditions = [eq(activitySessions.userId, member.userId)];
        if (query.from) memberConditions.push(gte(activitySessions.startedAt, new Date(query.from)));
        if (query.to) memberConditions.push(lte(activitySessions.startedAt, new Date(query.to)));

        const [stats] = await db
          .select({
            totalIdleSeconds: sql<number>`coalesce(sum(least(${activitySessions.idleSeconds}, 86400)), 0)::int`,
            totalKeystrokes: sql<number>`coalesce(sum(${activitySessions.totalKeystrokes}), 0)::int`,
            sessionCount: sql<number>`count(*)::int`,
            lastActive: sql<string>`max(${activitySessions.startedAt})`,
          })
          .from(activitySessions)
          .where(and(...memberConditions));

        return {
          ...member,
          ...stats,
          totalActiveSeconds: activeByUser.get(member.userId) ?? 0,
        };
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
      // Create a manual session entry. activeSeconds on the session is kept
      // for debugging only — payroll reads from screenshots now (count × 300).
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

      // Create one blank "screenshot" per 5-min interval the manual entry
      // covers. Payroll math is count(live screenshots) * 300, so for a
      // 1-hour manual entry we need 12 placeholder rows, for 8 hours we
      // need 96, etc. Without this, manual entries silently undercounted
      // to a flat 5 minutes regardless of how many hours admin entered.
      //
      // Capped at 288 rows (a full 24h day) as a safety net — admin form
      // already limits to 86400s, but defensive math here too.
      const SLOT_SECONDS = 300;
      const slotCount = Math.min(288, Math.max(1, Math.ceil(body.activeSeconds / SLOT_SECONDS)));
      const screenshotRows = Array.from({ length: slotCount }, (_, i) => ({
        userId: body.userId,
        sessionId: session.id,
        filename: "manual-entry.png",
        storagePath: "",
        imageData: null,
        fileSizeBytes: 0,
        metadata: {
          manualEntry: true,
          slotIndex: i + 1,
          slotCount,
          addedBy: request.user.sub,
          addedByEmail: request.user.email,
          note: body.note || "Manually added by admin",
        },
        // Stagger captured_at by 5 min so each "slot" sits in a distinct
        // bucket — helps when downstream reports group screenshots by
        // 5-min windows.
        capturedAt: new Date(startedAt.getTime() + i * SLOT_SECONDS * 1000),
      }));
      await db.insert(screenshots).values(screenshotRows);

      console.log(`[Activity] Manual entry: ${body.activeSeconds}s (${slotCount} slots) for user ${body.userId} on ${body.date} by admin ${request.user.email}`);

      return reply.send({
        ok: true,
        sessionId: session.id,
        activeSeconds: body.activeSeconds,
        slotCount,
        date: body.date,
      });
    } catch (err) {
      console.error("[Activity] Manual entry failed:", err);
      return reply.status(500).send({ error: "Failed to create manual entry", message: String(err) });
    }
  });

  // ─── Team Snapshot (pivoted timesheet grid) ───
  // See TEAM_SNAPSHOT_SPEC.md for the design behind this endpoint.
  app.get("/api/team-snapshot", { preHandler: auth }, async (request, reply) => {
    const query = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      // Optional admin-only filter: limit to one manager group
      managerName: z.string().optional(),
    }).parse(request.query);

    const isAdmin = request.user.role === "admin" || request.user.role === "super_admin";
    const isManager = isAdmin || request.user.role === "manager";

    // Resolve current user's fullName so managers can be filtered to their own team
    const [me] = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, request.user.sub))
      .limit(1);
    if (!me) return reply.status(404).send({ error: "User not found" });

    // Build the date column list: from..to inclusive, but cap the upper
    // bound at YESTERDAY. Today is excluded (still in progress), and any
    // date in the future is also excluded — without this, picking "May 2026"
    // mid-May would render columns for May 20-31 with nobody able to have
    // tracked yet. Sort newest-first to keep the most recent days on the left.
    const todayStr = new Date().toISOString().slice(0, 10);
    const dates: string[] = [];
    {
      const start = new Date(`${query.from}T00:00:00Z`);
      const end = new Date(`${query.to}T00:00:00Z`);
      for (let d = new Date(end); d >= start; d.setUTCDate(d.getUTCDate() - 1)) {
        const s = d.toISOString().slice(0, 10);
        if (s >= todayStr) continue; // skip today AND any future day
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

    // Restrict to users that exist in the employee directory (when one exists).
    // Without this we'd show seed/test rows (Bob Smith, Alice Johnson, etc.)
    // that nobody ever imported via the HR CSV.
    const dirEmails = await loadDirectoryEmailSet(db);
    const dirFiltered = dirEmails
      ? userRows.filter((u) => dirEmails.has((u.email || "").trim().toLowerCase()) || u.id === me.id)
      : userRows;

    // Visibility tiers:
    //   - super_admin / admin → everyone
    //   - manager → people on their team + themselves
    //   - everyone else (developer / employee) → themselves only
    // We always include the viewer themselves so the grid is never empty.
    const visibleUsers = isAdmin
      ? dirFiltered
      : isManager
        ? dirFiltered.filter((u) => u.team === me.fullName || u.id === me.id)
        : dirFiltered.filter((u) => u.id === me.id);

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

    // Build a typed UUID list for the IN clause. Using a sql.join of casted
    // placeholders avoids the postgres-js "cannot cast type record to uuid[]"
    // error that ANY(${jsArray}::uuid[]) hits when the driver can't infer
    // the element type from a plain JS array.
    const userIdList = sql.join(
      visibleIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );

    // PAYROLL: Team Snapshot's "activeSeconds" displayed in each cell is the
    // BILLABLE number — count(live screenshots in that day) * 300 — NOT the
    // raw active_seconds from activity_sessions. This is what HR pays from.
    //
    // We still pull activity_sessions for autoCount/manualCount per day
    // (used to mark "all-manual" rows in the grid), but the seconds value
    // shown to the user comes purely from screenshot count. Deleting a
    // screenshot subtracts 5 min automatically next time the page loads;
    // missing screenshots automatically reduce pay with no extra logic.
    const sessAgg = await db.execute<{ userId: string; day: string; autoCount: number; manualCount: number }>(sql`
      SELECT
        s.user_id::text AS "userId",
        to_char(s.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "day",
        COUNT(*) FILTER (WHERE s.editor_version IS DISTINCT FROM 'manual-entry')::int AS "autoCount",
        COUNT(*) FILTER (WHERE s.editor_version = 'manual-entry')::int AS "manualCount"
      FROM activity_sessions s
      WHERE s.user_id IN (${userIdList})
        AND s.started_at >= ${fromTs}::timestamptz
        AND s.started_at <= ${toTs}::timestamptz
      GROUP BY s.user_id, day
    `);

    const ssAgg = await db.execute<{ userId: string; day: string; ssCount: number }>(sql`
      SELECT
        ss.user_id::text AS "userId",
        to_char(ss.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "day",
        COUNT(*)::int AS "ssCount"
      FROM screenshots ss
      WHERE ss.user_id IN (${userIdList})
        AND ss.deleted_at IS NULL
        AND ss.captured_at >= ${fromTs}::timestamptz
        AND ss.captured_at <= ${toTs}::timestamptz
      GROUP BY ss.user_id, day
    `);

    // Merge the two aggregates by (userId, day). The cell value in the grid
    // (activeSeconds field, kept for response-shape compatibility) is
    // ssCount * 300 = billable seconds. autoCount/manualCount survive from
    // the sessions query to support the all-manual flag below.
    const byUser = new Map<string, Map<string, AggRow>>();
    const userTotals = new Map<string, { active: number; auto: number; manual: number }>();

    const upsert = (userId: string, day: string): AggRow => {
      let perDay = byUser.get(userId);
      if (!perDay) { perDay = new Map(); byUser.set(userId, perDay); }
      let row = perDay.get(day);
      if (!row) {
        row = { userId, day, activeSeconds: 0, autoCount: 0, manualCount: 0 };
        perDay.set(day, row);
      }
      return row;
    };

    for (const r of sessAgg as unknown as Array<{ userId: string; day: string; autoCount: number; manualCount: number }>) {
      const row = upsert(r.userId, r.day);
      row.autoCount = r.autoCount;
      row.manualCount = r.manualCount;
    }
    for (const r of ssAgg as unknown as Array<{ userId: string; day: string; ssCount: number }>) {
      const row = upsert(r.userId, r.day);
      // Cap at 24h per day per user just in case the screenshot count is
      // wildly off (e.g. someone uploaded a backlog of 1000 shots). Real
      // legit days won't hit this — a user can only physically take 288
      // shots in a 24h day at the 5min cadence (≈ 86400s).
      row.activeSeconds = Math.min(r.ssCount * BILLABLE_SECONDS_PER_SCREENSHOT, 86400);
    }

    // Compute per-user totals from the merged rows
    for (const [userId, perDay] of byUser.entries()) {
      const totals = { active: 0, auto: 0, manual: 0 };
      for (const row of perDay.values()) {
        totals.active += row.activeSeconds;
        totals.auto += row.autoCount;
        totals.manual += row.manualCount;
      }
      userTotals.set(userId, totals);
    }

    // Bucket users into manager groups. Manager identity = users.team value.
    // Anyone whose team is null/empty goes into "Unassigned".
    //
    // Special case (Cattr parity): if a user is THEMSELVES a manager — i.e.
    // someone else's team field matches their fullName — they get placed at
    // the top of their own team's bucket instead of falling through to
    // "Unassigned". This lets a manager who also tracks time see their own
    // hours alongside their reports.
    const managerNames = new Set(
      visibleUsers
        .map((u) => (u.team || "").trim())
        .filter((t) => t.length > 0)
    );
    const groupBuckets = new Map<string, typeof visibleUsers>();
    for (const u of visibleUsers) {
      const team = (u.team || "").trim();
      let key: string;
      if (team) {
        key = team;
      } else if (u.fullName && managerNames.has(u.fullName)) {
        // User is referenced as a manager by at least one report → bucket
        // them into their own team rather than "Unassigned".
        key = u.fullName;
      } else {
        key = "Unassigned";
      }
      // Admin-only filter: skip groups that don't match the requested manager
      if (isAdmin && query.managerName && key !== query.managerName) continue;
      const bucket = groupBuckets.get(key) || [];
      bucket.push(u);
      groupBuckets.set(key, bucket);
    }

    // Build the response groups. Inside each group we sort employees by ATD
    // descending so the best-performing reports float to the top of their
    // manager's section — matches Cattr's Time Report convention. Falls back
    // to fullName for stable ordering when two people share ATD (e.g. both 0).
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
        // True when this employee's fullName matches their own group's
        // managerName — i.e. the user is being shown inside their own team.
        // Frontend uses this to render a "(Manager)" label next to the name.
        const isOwnManager = u.fullName === managerName;
        return {
          userId: u.id,
          fullName: u.fullName,
          email: u.email,
          atdSeconds,
          isAllManual,
          isOwnManager,
          employmentStatus: u.employmentStatus,
          perDate,
        };
      })
      // Manager-themselves first (pinned to top of their own team).
      // Then ATD desc; tiebreak alphabetical for stable 0-ATD ordering.
      .sort((a, b) => {
        if (a.isOwnManager && !b.isOwnManager) return -1;
        if (!a.isOwnManager && b.isOwnManager) return 1;
        return (b.atdSeconds - a.atdSeconds) || (a.fullName ?? "").localeCompare(b.fullName ?? "");
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
      .select({ id: users.id, fullName: users.fullName, email: users.email, team: users.team, employmentStatus: users.employmentStatus })
      .from(users)
      .where(and(eq(users.isActive, true), eq(users.employmentStatus, "active")));

    // Filter to employee_directory entries only (see helper for rationale)
    const dirEmails = await loadDirectoryEmailSet(db);
    const dirFiltered = dirEmails
      ? allUsers.filter((u) => dirEmails.has((u.email || "").trim().toLowerCase()) || u.id === me.id)
      : allUsers;

    const visibleUsers = isAdmin
      ? dirFiltered
      : dirFiltered.filter((u) => u.team === me.fullName || u.id === me.id);
    if (visibleUsers.length === 0) return reply.send({ workingDays, rows: [] });

    const visibleIds = visibleUsers.map((u) => u.id);

    // Active seconds = screenshot-count × 300 per user, via shared helper.
    // Defines the bandwidth report's actual-hours number — anything HR pays
    // out comes from here.
    const totalsByUser = await loadActiveSecondsByUser(db, {
      userIds: visibleIds,
      from: new Date(`${query.from}T00:00:00Z`),
      to: new Date(`${query.to}T23:59:59Z`),
    });

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
      .select({ id: users.id, fullName: users.fullName, email: users.email, team: users.team })
      .from(users)
      .where(and(eq(users.isActive, true), eq(users.employmentStatus, "active")));

    // Filter to employee_directory entries only (see helper for rationale)
    const dirEmails = await loadDirectoryEmailSet(db);
    const dirFiltered = dirEmails
      ? allUsers.filter((u) => dirEmails.has((u.email || "").trim().toLowerCase()) || u.id === me.id)
      : allUsers;

    const visibleUsers = isAdmin
      ? dirFiltered
      : dirFiltered.filter((u) => u.team === me.fullName || u.id === me.id);
    const visibleIds = visibleUsers.map((u) => u.id);

    if (visibleUsers.length === 0) {
      return reply.send({
        totalActiveEmployees: 0,
        workingDays,
        avgHoursPerEmployeePerDay: 0,
        distribution: { good: 0, moderate: 0, low: 0, none: 0 },
        underperformers: [],
        underutilizedManagers: [],
        notLogged: [],
      });
    }

    // Per-(user, day) active seconds from screenshots, via shared helper.
    const cellByUserDay = await loadActiveSecondsByUserDay(db, {
      userIds: visibleIds,
      from: new Date(`${query.from}T00:00:00Z`),
      to: new Date(`${query.to}T23:59:59Z`),
    });
    let totalActiveSeconds = 0;
    for (const v of cellByUserDay.values()) totalActiveSeconds += v;

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

    // Walk every (user × working-day) cell, bucket for distribution AND
    // accumulate per-user totals so we can derive the underperformer /
    // underutilized-manager / not-logged lists below. One pass instead of
    // three keeps this cheap even for 200+ employees.
    const distribution = { good: 0, moderate: 0, low: 0, none: 0 };
    const perUser = new Map<string, { secondsTotal: number; daysWithData: number }>();
    for (const u of visibleUsers) {
      const stats = { secondsTotal: 0, daysWithData: 0 };
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const wd = d.getUTCDay();
        if (wd === 0 || wd === 6) continue;
        const day = d.toISOString().slice(0, 10);
        if (summaryHolidaySet.has(day)) continue;
        if (leaveSet.has(`${u.id}|${day}`)) continue;
        const seconds = cellByUserDay.get(`${u.id}|${day}`) || 0;
        const hours = seconds / 3600;
        if (seconds === 0) {
          distribution.none += 1;
        } else {
          stats.secondsTotal += seconds;
          stats.daysWithData += 1;
          if (hours >= 7) distribution.good += 1;
          else if (hours >= 4) distribution.moderate += 1;
          else distribution.low += 1;
        }
      }
      perUser.set(u.id, stats);
    }

    // ── Underperformers: avg < 4h/day, computed across days-with-data only ──
    // Matches Cattr's denominator semantics (fair to people who only worked a
    // few days). Excludes "not logged" employees — they get their own bucket.
    type Performer = { name: string; manager: string; hours: number };
    const underperformers: Performer[] = [];
    const notLogged: string[] = [];
    for (const u of visibleUsers) {
      const stats = perUser.get(u.id) ?? { secondsTotal: 0, daysWithData: 0 };
      if (stats.daysWithData === 0) {
        notLogged.push(u.fullName || u.email || "Unknown");
        continue;
      }
      const avgHours = stats.secondsTotal / 3600 / stats.daysWithData;
      if (avgHours < 4) {
        underperformers.push({
          name: u.fullName || u.email || "Unknown",
          manager: u.team || "Unknown",
          hours: Math.round(avgHours * 10) / 10,
        });
      }
    }
    underperformers.sort((a, b) => a.hours - b.hours); // worst first

    // ── Underutilized Managers: 20%+ of their team is red (avg < 4h) ──
    // Group by team (= manager's fullName). Unknown / unassigned employees
    // bucket into "Unassigned" so we don't silently drop them.
    const managerStats = new Map<string, { total: number; red: number }>();
    const redByUserId = new Set(
      underperformers.map((p, i) => visibleUsers.find((u) => (u.fullName || u.email) === p.name)?.id).filter(Boolean),
    );
    // Build red-set the cheap way — re-walk visibleUsers using perUser data
    redByUserId.clear();
    for (const u of visibleUsers) {
      const stats = perUser.get(u.id) ?? { secondsTotal: 0, daysWithData: 0 };
      if (stats.daysWithData === 0) continue; // not logged → not red
      const avgHours = stats.secondsTotal / 3600 / stats.daysWithData;
      if (avgHours < 4) redByUserId.add(u.id);
    }
    for (const u of visibleUsers) {
      const key = u.team && u.team.trim() !== "" ? u.team : "Unassigned";
      const cur = managerStats.get(key) || { total: 0, red: 0 };
      cur.total += 1;
      if (redByUserId.has(u.id)) cur.red += 1;
      managerStats.set(key, cur);
    }
    const underutilizedManagers = Array.from(managerStats.entries())
      .filter(([_, s]) => s.total > 0 && s.red / s.total >= 0.2)
      .map(([name, s]) => ({
        name,
        redCount: s.red,
        totalCount: s.total,
        percent: Math.round((s.red / s.total) * 100),
      }))
      .sort((a, b) => b.percent - a.percent);

    const totalEmployeeDays = visibleUsers.length * workingDays;
    const avgHoursPerEmployeePerDay = totalEmployeeDays > 0
      ? Math.round((totalActiveSeconds / 3600 / totalEmployeeDays) * 10) / 10
      : 0;

    return reply.send({
      totalActiveEmployees: visibleUsers.length,
      workingDays,
      avgHoursPerEmployeePerDay,
      distribution,
      underperformers,
      underutilizedManagers,
      notLogged,
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

  // ─── Payroll CSV export (super-admin only) ──────────────────────────────
  // HR's monthly hand-off. Streams a CSV laid out like the Team Snapshot
  // grid: one row per employee, one column per day, cells = decimal hours
  // OR labels (Sun / Sat / Holiday / Leave / Half day) for non-working days.
  //
  // Active time is the screenshot-derived payroll number (same as every
  // other endpoint in this file). Idle/keystrokes are NOT included — HR's
  // CSV is purely hours-by-day. If they want diagnostic stats they can
  // open the dashboard.
  //
  // Filter: employee_directory only. Seed/test users in `users` that were
  // never imported via HR's CSV are skipped — same rule as Team Snapshot.
  app.get("/api/admin/payroll/csv", { preHandler: requireSuperAdmin(authService) }, async (request, reply) => {
    // Default: current calendar month, in UTC (matches how active_seconds /
    // screenshots get bucketed everywhere else in this file).
    const now = new Date();
    const defaultFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
      .toISOString().slice(0, 10);

    const query = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(defaultFrom),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(defaultTo),
    }).parse(request.query);

    // Build the date column list — inclusive, oldest → newest (HR reads
    // left to right). Cap at 62 days so a fat-fingered range doesn't OOM
    // the response.
    const start = new Date(`${query.from}T00:00:00Z`);
    const end = new Date(`${query.to}T00:00:00Z`);
    if (end < start) return reply.status(400).send({ error: "to is before from" });
    const dates: string[] = [];
    for (let d = new Date(start); d <= end && dates.length < 62; d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }
    if (dates.length === 0) return reply.status(400).send({ error: "empty range" });

    // Employees from the HR directory — left-join users so we get the
    // canonical user_id even if the directory row lists only an email.
    // Users without a directory row are excluded; users in the directory
    // who never logged in show up with no hours (intentional — HR sees
    // they were employed but didn't track).
    const employees = await db
      .select({
        userId: users.id,
        email: employeeDirectory.email,
        fullName: users.fullName,
        team: users.team,
        employmentStatus: users.employmentStatus,
      })
      .from(employeeDirectory)
      .leftJoin(users, eq(sql`lower(${users.email})`, sql`lower(${employeeDirectory.email})`));

    // Holidays + leaves in the date range, indexed for cell rendering.
    const holidayRows = await db
      .select({ date: holidays.date, name: holidays.name })
      .from(holidays)
      .where(and(gte(holidays.date, query.from), lte(holidays.date, query.to)));
    const holidayByDate = new Map<string, string>();
    for (const h of holidayRows) holidayByDate.set(h.date as unknown as string, h.name);

    const userIds = employees.map((e) => e.userId).filter((id): id is string => !!id);
    const leaveRows = userIds.length > 0
      ? await db
          .select({ userId: leaveDays.userId, date: leaveDays.date, leaveType: leaveDays.leaveType })
          .from(leaveDays)
          .where(and(
            inArray(leaveDays.userId, userIds),
            gte(leaveDays.date, query.from),
            lte(leaveDays.date, query.to),
          ))
      : [];
    const leaveByUserDate = new Map<string, string>(); // key: userId|date → label
    const LEAVE_LABEL: Record<string, string> = {
      full: "Leave", half: "Half day", sick: "Sick leave",
      paid: "Paid leave", unpaid: "Unpaid leave",
    };
    for (const r of leaveRows) {
      leaveByUserDate.set(`${r.userId}|${r.date}`, LEAVE_LABEL[r.leaveType] ?? r.leaveType);
    }

    // Active seconds per (user, day) from screenshots — same source of
    // truth as every other payroll-impacting endpoint here.
    const activeByUserDay = userIds.length > 0
      ? await loadActiveSecondsByUserDay(db, {
          userIds,
          from: new Date(`${query.from}T00:00:00Z`),
          to: new Date(`${query.to}T23:59:59Z`),
        })
      : new Map<string, number>();

    // ── Render the CSV ──
    // Decimal hours, 2dp. Special labels for non-working / non-work days
    // override the number so HR sees WHY a cell is blank instead of just "0".
    const formatCell = (userId: string | null, date: string): string => {
      const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (wd === 0) return "Sun";
      if (wd === 6) return "Sat";
      if (holidayByDate.has(date)) return holidayByDate.get(date)!;
      if (userId && leaveByUserDate.has(`${userId}|${date}`)) {
        return leaveByUserDate.get(`${userId}|${date}`)!;
      }
      if (!userId) return ""; // employee never logged in — empty cell
      const seconds = activeByUserDay.get(`${userId}|${date}`) ?? 0;
      return (seconds / 3600).toFixed(2);
    };

    // CSV escape: wrap in quotes and double any embedded quotes. Numbers
    // and clean labels pass through; only names/labels with commas need it.
    const csvEscape = (s: string): string => {
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const header = [
      "Employee Email",
      "Employee Name",
      "Team",
      "Status",
      ...dates,
      "Total Hours",
    ].map(csvEscape).join(",");

    const rows = employees.map((emp) => {
      let totalSeconds = 0;
      const cells = dates.map((d) => {
        const cell = formatCell(emp.userId, d);
        // Only numeric cells contribute to the total
        if (/^\d+\.\d{2}$/.test(cell)) {
          totalSeconds += parseFloat(cell) * 3600;
        }
        return csvEscape(cell);
      });
      const totalHours = (totalSeconds / 3600).toFixed(2);
      return [
        csvEscape(emp.email ?? ""),
        csvEscape(emp.fullName ?? ""),
        csvEscape(emp.team ?? ""),
        csvEscape(emp.employmentStatus ?? "unknown"),
        ...cells,
        totalHours,
      ].join(",");
    });

    const body = [header, ...rows].join("\n") + "\n";

    const filename = `ailancers-payroll-${query.from}-to-${query.to}.csv`;
    return reply
      .type("text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(body);
  });
}
