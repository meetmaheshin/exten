import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/requireAuth.js";
import type { AuthService } from "../services/AuthService.js";
import type { Database } from "../config/database.js";
import { ProjectSyncService } from "../services/ProjectSyncService.js";
import {
  externalProjects,
  externalTasks,
  externalUserMappings,
  employeeDirectory,
  users,
} from "../models/index.js";

export function externalProjectsRoutes(
  app: FastifyInstance,
  authService: AuthService,
  db: Database
) {
  const auth = requireAuth(authService);
  const admin = requireAdmin(authService);
  const syncService = new ProjectSyncService(db);

  // ─────────────────────────────────────────────────────────────────────────
  // Admin: trigger a full sync from the external platform API
  // ─────────────────────────────────────────────────────────────────────────
  app.post("/api/admin/sync/projects", { preHandler: admin }, async (_request, reply) => {
    const result = await syncService.sync();
    return reply.send(result);
  });

  // Admin: import employee directory (CSV data as JSON array)
  // Each entry: { externalUserId, employeeName, email, department?, jobPosition?, managerName?, company?, active? }
  // Helper: copy manager_name from employee_directory → users.team for every
  // directory row whose email matches an Ailancers login (case-insensitive).
  // Returns counts so the caller can show them to the admin.
  async function autoLinkEmployeesToUsers() {
    const result = await db.execute<{ matchedRows: number; updatedRows: number; directoryRows: number }>(sql`
      WITH dir AS (
        SELECT email, manager_name FROM employee_directory WHERE manager_name IS NOT NULL AND manager_name <> ''
      ),
      matches AS (
        SELECT u.id, dir.manager_name
        FROM users u
        JOIN dir ON LOWER(u.email) = LOWER(dir.email)
      ),
      upd AS (
        UPDATE users u
        SET team = m.manager_name, updated_at = NOW()
        FROM matches m
        WHERE u.id = m.id
          AND (u.team IS NULL OR u.team <> m.manager_name)
        RETURNING u.id
      )
      SELECT
        (SELECT COUNT(*) FROM matches)::int AS "matchedRows",
        (SELECT COUNT(*) FROM upd)::int AS "updatedRows",
        (SELECT COUNT(*) FROM employee_directory)::int AS "directoryRows"
    `);
    const row = (result as unknown as Array<{ matchedRows: number; updatedRows: number; directoryRows: number }>)[0];
    return {
      directoryRows: row?.directoryRows ?? 0,
      matchedRows: row?.matchedRows ?? 0,
      updatedRows: row?.updatedRows ?? 0,
      unmappedRows: (row?.directoryRows ?? 0) - (row?.matchedRows ?? 0),
    };
  }

  app.post("/api/admin/employees/import", { preHandler: admin }, async (request, reply) => {
    const body = z.object({
      employees: z.array(z.object({
        externalUserId: z.number().int().positive(),
        employeeName: z.string().min(1),
        email: z.string().min(1),
        department: z.string().optional(),
        jobPosition: z.string().optional(),
        managerName: z.string().optional(),
        company: z.string().optional(),
        active: z.boolean().optional(),
      })),
    }).parse(request.body);

    const result = await syncService.importEmployeeDirectory(body.employees);
    const link = await autoLinkEmployeesToUsers();
    return reply.send({ ...result, link });
  });

  // Admin: import employee directory from raw CSV text
  // Expects CSV with headers: Active,Activities,Company,Department,Employee Name,Job Position,Manager,Next Activity Deadline,Work Address,Work Email,Work Phone,User/ID
  app.post("/api/admin/employees/import-csv", { preHandler: admin }, async (request, reply) => {
    const body = z.object({ csv: z.string().min(10) }).parse(request.body);
    const lines = body.csv.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return reply.status(400).send({ error: "CSV must have header + data rows" });

    // Parse CSV (handle quoted fields)
    const parseRow = (line: string): string[] => {
      const result: string[] = [];
      let current = "";
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; continue; }
        current += ch;
      }
      result.push(current.trim());
      return result;
    };

    const rows = lines.slice(1).map(parseRow).filter((cols) => {
      const userId = parseInt(cols[11], 10); // User/ID column
      const email = cols[9]; // Work Email column
      return userId > 0 && email && email !== "N/A" && email !== "test" && email.includes("@");
    }).map((cols) => ({
      externalUserId: parseInt(cols[11], 10),
      employeeName: cols[4] || "Unknown",
      email: cols[9],
      department: cols[3] || undefined,
      jobPosition: cols[5] || undefined,
      managerName: cols[6] || undefined,
      company: cols[2] || undefined,
      // Odoo-style "True"/"False" with mixed casing, plus lowercase / 1 / yes
      active: ["true", "1", "yes", "y"].includes((cols[0] ?? "").trim().toLowerCase()),
    }));

    const result = await syncService.importEmployeeDirectory(rows);
    const link = await autoLinkEmployeesToUsers();
    return reply.send({ ...result, link, totalRows: lines.length - 1, parsedRows: rows.length });
  });

  // Admin: re-run the directory → users.team auto-link without re-importing
  app.post("/api/admin/employees/auto-link", { preHandler: admin }, async (_request, reply) => {
    const link = await autoLinkEmployeesToUsers();
    return reply.send(link);
  });

  // Admin: get sync status (when was last sync, how many projects/tasks)
  app.get("/api/admin/sync/status", { preHandler: admin }, async (_request, reply) => {
    const [projectStats] = await db
      .select({
        totalProjects: sql<number>`count(*)::int`,
        lastSync: sql<string>`max(last_synced_at)`,
        activeProjects: sql<number>`count(*) filter (where active = true and is_closed = false)::int`,
      })
      .from(externalProjects);

    const [taskStats] = await db
      .select({ totalTasks: sql<number>`count(*)::int` })
      .from(externalTasks);

    const [mappingStats] = await db
      .select({ mappedUsers: sql<number>`count(*)::int` })
      .from(externalUserMappings);

    return reply.send({
      projects: projectStats,
      tasks: taskStats,
      userMappings: mappingStats,
    });
  });

  // Admin: list all employees from the directory
  app.get("/api/admin/employees", { preHandler: admin }, async (_request, reply) => {
    const employees = await db
      .select()
      .from(employeeDirectory)
      .orderBy(employeeDirectory.employeeName);

    return reply.send({ data: employees });
  });

  // Admin: list all external projects with task counts
  app.get("/api/admin/external-projects", { preHandler: admin }, async (request, reply) => {
    const query = z.object({
      search: z.string().optional(),
      active: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(request.query);

    const conditions = [];
    if (query.active !== undefined) conditions.push(eq(externalProjects.active, query.active));
    if (query.search) {
      conditions.push(sql`${externalProjects.name} ilike ${"%" + query.search + "%"}`);
    }

    const projects = await db
      .select()
      .from(externalProjects)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(externalProjects.lastSyncedAt))
      .limit(query.limit)
      .offset(query.offset);

    return reply.send({ data: projects });
  });

  // Admin: manually set user mapping
  app.put("/api/admin/user-mappings/:userId", { preHandler: admin }, async (request, reply) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      externalUserId: z.number().int().positive(),
      externalUserName: z.string().min(1),
    }).parse(request.body);

    await db
      .insert(externalUserMappings)
      .values({
        userId,
        externalUserId: body.externalUserId,
        externalUserName: body.externalUserName,
        matchType: "manual",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: externalUserMappings.userId,
        set: {
          externalUserId: body.externalUserId,
          externalUserName: body.externalUserName,
          matchType: "manual",
          updatedAt: new Date(),
        },
      });

    return reply.send({ ok: true });
  });

  // Admin: list all user mappings with user info
  app.get("/api/admin/user-mappings", { preHandler: admin }, async (_request, reply) => {
    const mappings = await db
      .select({
        userId: externalUserMappings.userId,
        externalUserId: externalUserMappings.externalUserId,
        externalUserName: externalUserMappings.externalUserName,
        matchType: externalUserMappings.matchType,
        email: users.email,
        fullName: users.fullName,
        updatedAt: externalUserMappings.updatedAt,
      })
      .from(externalUserMappings)
      .leftJoin(users, sql`${externalUserMappings.userId}::uuid = ${users.id}`)
      .orderBy(externalUserMappings.externalUserName);

    return reply.send({ data: mappings });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Developer: get projects assigned to the logged-in user
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/projects/mine", { preHandler: auth }, async (request, reply) => {
    const userId = request.user.sub;

    // Look up their external user ID
    const [mapping] = await db
      .select()
      .from(externalUserMappings)
      .where(eq(externalUserMappings.userId, userId))
      .limit(1);

    // If no confirmed mapping yet, try email first, then fall back to name matching
    let externalUserId: number | null = mapping?.externalUserId ?? null;

    if (!externalUserId) {
      const [user] = await db
        .select({ fullName: users.fullName, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      // 1) Try email match via employee directory (most reliable)
      if (user?.email) {
        const emailMatch = await syncService.findExternalUserByEmail(user.email);
        if (emailMatch) {
          externalUserId = emailMatch.id;
          await db
            .insert(externalUserMappings)
            .values({
              userId,
              externalUserId: emailMatch.id,
              externalUserName: emailMatch.name,
              matchType: "email",
            })
            .onConflictDoNothing();
        }
      }

      // 2) Fall back to name matching if email didn't work
      if (!externalUserId && user?.fullName) {
        const candidates = await syncService.findExternalUserCandidatesByName(user.fullName);

        if (candidates.length === 1) {
          externalUserId = candidates[0].id;
          await db
            .insert(externalUserMappings)
            .values({
              userId,
              externalUserId: candidates[0].id,
              externalUserName: candidates[0].name,
              matchType: "exact",
            })
            .onConflictDoNothing();
        } else if (candidates.length > 1) {
          return reply.send({
            data: [],
            externalUserId: null,
            mapped: false,
            needsIdentityConfirmation: true,
            candidates,
          });
        }
      }
    }

    if (!externalUserId) {
      return reply.send({ data: [], externalUserId: null, mapped: false, needsIdentityConfirmation: false });
    }

    // Find all active projects where this external user is in assignee_ids
    // OR is assigned to at least one task
    // NOTE: Use sql.raw for the full query because Drizzle's parameterized sql template
    // double-escapes JSONB string params, making @> containment fail.
    const assigneeJson = JSON.stringify([externalUserId]);
    const userMatchJson = JSON.stringify([{ id: externalUserId }]);
    const assignedProjects = await db.execute<{
      id: number;
      name: string;
      stage_name: string;
      owner_name: string | null;
      business_unit: string | null;
      task_count: number;
      date_end: string | null;
    }>(
      sql.raw(`SELECT DISTINCT
            ep.id,
            ep.name,
            ep.stage_name,
            ep.owner_name,
            ep.business_unit,
            ep.task_count,
            ep.date_end
          FROM external_projects ep
          WHERE ep.active = true
            AND ep.is_closed = false
            AND (
              ep.assignee_ids @> '${assigneeJson}'::jsonb
              OR EXISTS (
                SELECT 1 FROM external_tasks et
                WHERE et.project_id = ep.id
                  AND et.assigned_users @> '${userMatchJson}'::jsonb
              )
            )
          ORDER BY ep.name`)
    );

    // For each project, get the tasks assigned to this user
    const projectIds = Array.from(assignedProjects).map((p) => p.id);

    let tasksByProject: Record<number, Array<{
      id: number;
      name: string;
      state: string | null;
      stageName: string | null;
      priority: string | null;
      dateDeadline: Date | null;
    }>> = {};

    if (projectIds.length > 0) {
      const tasks = await db.execute<{
        id: number;
        project_id: number;
        name: string;
        state: string | null;
        stage_name: string | null;
        priority: string | null;
        date_deadline: string | null;
      }>(
        sql.raw(`SELECT id, project_id, name, state, stage_name, priority, date_deadline
            FROM external_tasks
            WHERE project_id = ANY(ARRAY[${projectIds.join(",")}]::int[])
              AND assigned_users @> '${userMatchJson}'::jsonb
            ORDER BY
              CASE state
                WHEN '01_in_progress' THEN 0
                WHEN '04_waiting_normal' THEN 1
                ELSE 2
              END,
              date_deadline ASC NULLS LAST`)
      );

      for (const task of tasks) {
        if (!tasksByProject[task.project_id]) tasksByProject[task.project_id] = [];
        tasksByProject[task.project_id].push({
          id: task.id,
          name: task.name,
          state: task.state,
          stageName: task.stage_name,
          priority: task.priority,
          dateDeadline: task.date_deadline ? new Date(task.date_deadline) : null,
        });
      }
    }

    const result = Array.from(assignedProjects).map((p) => ({
      id: p.id,
      name: p.name,
      stageName: p.stage_name,
      ownerName: p.owner_name,
      businessUnit: p.business_unit,
      taskCount: p.task_count,
      dateEnd: p.date_end,
      myTasks: tasksByProject[p.id] ?? [],
    }));

    return reply.send({ data: result, externalUserId, mapped: true });
  });

  // Developer: explicitly confirm which platform user they are (resolves duplicate-name ambiguity)
  app.post("/api/projects/confirm-identity", { preHandler: auth }, async (request, reply) => {
    const body = z.object({
      externalUserId: z.number().int().positive(),
      externalUserName: z.string().min(1),
    }).parse(request.body);

    await db
      .insert(externalUserMappings)
      .values({
        userId: request.user.sub,
        externalUserId: body.externalUserId,
        externalUserName: body.externalUserName,
        matchType: "confirmed",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: externalUserMappings.userId,
        set: {
          externalUserId: body.externalUserId,
          externalUserName: body.externalUserName,
          matchType: "confirmed",
          updatedAt: new Date(),
        },
      });

    return reply.send({ ok: true });
  });

  // Developer: get tasks for a specific project (their tasks only)
  app.get("/api/projects/:projectId/tasks", { preHandler: auth }, async (request, reply) => {
    const { projectId } = z.object({
      projectId: z.coerce.number().int().positive(),
    }).parse(request.params);

    const userId = request.user.sub;
    const [mapping] = await db
      .select({ externalUserId: externalUserMappings.externalUserId })
      .from(externalUserMappings)
      .where(eq(externalUserMappings.userId, userId))
      .limit(1);

    const tasks = await db
      .select({
        id: externalTasks.id,
        name: externalTasks.name,
        state: externalTasks.state,
        stageName: externalTasks.stageName,
        priority: externalTasks.priority,
        dateDeadline: externalTasks.dateDeadline,
        milestoneId: externalTasks.milestoneId,
        milestoneName: externalTasks.milestoneName,
        assignedUsers: externalTasks.assignedUsers,
      })
      .from(externalTasks)
      .where(
        and(
          eq(externalTasks.projectId, projectId),
          mapping
            ? sql`${externalTasks.assignedUsers} @> ${JSON.stringify([{ id: mapping.externalUserId }])}::jsonb`
            : sql`false`
        )
      )
      .orderBy(externalTasks.dateDeadline);

    return reply.send({ data: tasks });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Admin: per-project time/activity breakdown
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/admin/projects/activity", { preHandler: admin }, async (request, reply) => {
    const query = z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(request.query);

    const fromFilter = query.from ? sql`AND s.started_at >= ${query.from}::timestamptz` : sql``;
    const toFilter = query.to ? sql`AND s.started_at <= ${query.to}::timestamptz` : sql``;

    const result = await db.execute<{
      project_id: number;
      project_name: string;
      stage_name: string | null;
      total_active_seconds: number;
      total_keystrokes: number;
      unique_developers: number;
      session_count: number;
    }>(
      sql`SELECT
            ep.id           AS project_id,
            ep.name         AS project_name,
            ep.stage_name,
            COALESCE(SUM(s.active_seconds), 0)::int   AS total_active_seconds,
            COALESCE(SUM(s.total_keystrokes), 0)::int AS total_keystrokes,
            COUNT(DISTINCT s.user_id)::int             AS unique_developers,
            COUNT(*)::int                              AS session_count
          FROM external_projects ep
          JOIN activity_sessions s ON s.external_project_id = ep.id
          WHERE ep.active = true ${fromFilter} ${toFilter}
          GROUP BY ep.id, ep.name, ep.stage_name
          ORDER BY total_active_seconds DESC
          LIMIT ${query.limit} OFFSET ${query.offset}`
    );

    return reply.send({ data: Array.from(result) });
  });

  // Admin: per-task breakdown for a project
  app.get("/api/admin/projects/:projectId/tasks/activity", { preHandler: admin }, async (request, reply) => {
    const { projectId } = z.object({
      projectId: z.coerce.number().int().positive(),
    }).parse(request.params);

    const result = await db.execute<{
      task_id: number;
      task_name: string;
      state: string | null;
      stage_name: string | null;
      total_active_seconds: number;
      unique_developers: number;
      session_count: number;
    }>(
      sql`SELECT
            et.id           AS task_id,
            et.name         AS task_name,
            et.state,
            et.stage_name,
            COALESCE(SUM(s.active_seconds), 0)::int AS total_active_seconds,
            COUNT(DISTINCT s.user_id)::int           AS unique_developers,
            COUNT(*)::int                            AS session_count
          FROM external_tasks et
          JOIN activity_sessions s ON s.external_task_id = et.id
          WHERE et.project_id = ${projectId}
          GROUP BY et.id, et.name, et.state, et.stage_name
          ORDER BY total_active_seconds DESC`
    );

    return reply.send({ data: Array.from(result) });
  });

  // Admin: which developer is on which project right now (live)
  app.get("/api/admin/projects/live", { preHandler: admin }, async (_request, reply) => {
    const result = await db.execute<{
      user_id: string;
      full_name: string;
      email: string;
      project_id: number | null;
      project_name: string | null;
      task_id: number | null;
      task_name: string | null;
      active_seconds_today: number;
      session_started_at: string;
    }>(
      sql`SELECT
            u.id            AS user_id,
            u.full_name,
            u.email,
            ep.id           AS project_id,
            ep.name         AS project_name,
            et.id           AS task_id,
            et.name         AS task_name,
            COALESCE(s.active_seconds, 0) AS active_seconds_today,
            s.started_at::text            AS session_started_at
          FROM activity_sessions s
          JOIN users u ON u.id = s.user_id
          LEFT JOIN external_projects ep ON ep.id = s.external_project_id
          LEFT JOIN external_tasks et ON et.id = s.external_task_id
          WHERE s.ended_at IS NULL
            AND s.started_at > now() - interval '24 hours'
          ORDER BY s.started_at DESC`
    );

    return reply.send({ data: Array.from(result) });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Admin: all external projects listing (with activity stats)
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/admin/projects/list", { preHandler: admin }, async (request, reply) => {
    const query = z.object({
      search: z.string().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(request.query);

    const searchFilter = query.search
      ? sql`AND ep.name ILIKE ${"%" + query.search + "%"}`
      : sql``;

    // Optional date window. Applied inside the LATERAL subquery so projects
    // whose activity sits outside the window still appear in the list (with
    // zeroed stats), instead of vanishing entirely — admins still want to see
    // their full project list.
    const fromFilter = query.from ? sql`AND s.started_at >= ${query.from}::timestamptz` : sql``;
    const toFilter = query.to ? sql`AND s.started_at <= ${query.to}::timestamptz` : sql``;

    const result = await db.execute<{
      id: number;
      name: string;
      stage_name: string | null;
      owner_name: string | null;
      business_unit: string | null;
      task_count: number;
      active: boolean;
      total_active_seconds: number;
      unique_developers: number;
      session_count: number;
    }>(
      sql`SELECT
            ep.id, ep.name, ep.stage_name, ep.owner_name, ep.business_unit,
            ep.task_count, ep.active,
            COALESCE(stats.total_active_seconds, 0)::int AS total_active_seconds,
            COALESCE(stats.unique_developers, 0)::int AS unique_developers,
            COALESCE(stats.session_count, 0)::int AS session_count
          FROM external_projects ep
          LEFT JOIN LATERAL (
            SELECT
              SUM(s.active_seconds)::int AS total_active_seconds,
              COUNT(DISTINCT s.user_id)::int AS unique_developers,
              COUNT(*)::int AS session_count
            FROM activity_sessions s
            WHERE s.external_project_id = ep.id ${fromFilter} ${toFilter}
          ) stats ON true
          WHERE ep.active = true AND ep.is_closed = false ${searchFilter}
          ORDER BY COALESCE(stats.total_active_seconds, 0) DESC, ep.name
          LIMIT ${query.limit} OFFSET ${query.offset}`
    );

    return reply.send({ data: Array.from(result) });
  });

  // Admin: single project detail — users who worked on it with date breakdown
  app.get("/api/admin/projects/:projectId/detail", { preHandler: admin }, async (request, reply) => {
    const { projectId } = z.object({ projectId: z.coerce.number().int() }).parse(request.params);
    const query = z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }).parse(request.query);

    const fromFilter = query.from ? sql`AND s.started_at >= ${query.from}::timestamptz` : sql``;
    const toFilter = query.to ? sql`AND s.started_at <= ${query.to}::timestamptz` : sql``;

    // Project info
    const [project] = await db
      .select()
      .from(externalProjects)
      .where(eq(externalProjects.id, projectId))
      .limit(1);

    if (!project) return reply.status(404).send({ error: "Project not found" });

    // Users who worked on this project
    const userBreakdown = await db.execute<{
      user_id: string;
      full_name: string;
      email: string;
      total_active_seconds: number;
      total_idle_seconds: number;
      total_keystrokes: number;
      total_file_saves: number;
      session_count: number;
      last_active: string;
    }>(
      sql`SELECT
            u.id AS user_id, u.full_name, u.email,
            COALESCE(SUM(s.active_seconds), 0)::int AS total_active_seconds,
            COALESCE(SUM(s.idle_seconds), 0)::int AS total_idle_seconds,
            COALESCE(SUM(s.total_keystrokes), 0)::int AS total_keystrokes,
            COALESCE(SUM(s.total_file_saves), 0)::int AS total_file_saves,
            COUNT(*)::int AS session_count,
            MAX(s.started_at)::text AS last_active
          FROM activity_sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.external_project_id = ${projectId} ${fromFilter} ${toFilter}
          GROUP BY u.id, u.full_name, u.email
          ORDER BY total_active_seconds DESC`
    );

    // Daily breakdown
    const dailyBreakdown = await db.execute<{
      date: string;
      total_active_seconds: number;
      unique_developers: number;
      session_count: number;
    }>(
      sql`SELECT
            date(s.started_at) AS date,
            COALESCE(SUM(s.active_seconds), 0)::int AS total_active_seconds,
            COUNT(DISTINCT s.user_id)::int AS unique_developers,
            COUNT(*)::int AS session_count
          FROM activity_sessions s
          WHERE s.external_project_id = ${projectId} ${fromFilter} ${toFilter}
          GROUP BY date(s.started_at)
          ORDER BY date DESC`
    );

    // Task breakdown
    const taskBreakdown = await db.execute<{
      task_id: number;
      task_name: string;
      total_active_seconds: number;
      unique_developers: number;
      session_count: number;
    }>(
      sql`SELECT
            et.id AS task_id, et.name AS task_name,
            COALESCE(SUM(s.active_seconds), 0)::int AS total_active_seconds,
            COUNT(DISTINCT s.user_id)::int AS unique_developers,
            COUNT(*)::int AS session_count
          FROM activity_sessions s
          JOIN external_tasks et ON et.id = s.external_task_id
          WHERE s.external_project_id = ${projectId} ${fromFilter} ${toFilter}
          GROUP BY et.id, et.name
          ORDER BY total_active_seconds DESC`
    );

    return reply.send({
      project,
      users: Array.from(userBreakdown),
      daily: Array.from(dailyBreakdown),
      tasks: Array.from(taskBreakdown),
    });
  });

  // Admin: user sessions with task names (for user detail view)
  app.get("/api/admin/activity/user/:userId/sessions", { preHandler: admin }, async (request, reply) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const query = z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(request.query);

    const fromFilter = query.from ? sql`AND s.started_at >= ${query.from}::timestamptz` : sql``;
    const toFilter = query.to ? sql`AND s.started_at <= ${query.to}::timestamptz` : sql``;

    const sessions = await db.execute<{
      id: string;
      started_at: string;
      ended_at: string | null;
      active_seconds: number;
      idle_seconds: number;
      total_keystrokes: number;
      total_file_saves: number;
      project_name: string | null;
      task_name: string | null;
      os_platform: string | null;
    }>(
      sql`SELECT
            s.id, s.started_at::text, s.ended_at::text,
            COALESCE(s.active_seconds, 0) AS active_seconds,
            COALESCE(s.idle_seconds, 0) AS idle_seconds,
            COALESCE(s.total_keystrokes, 0) AS total_keystrokes,
            COALESCE(s.total_file_saves, 0) AS total_file_saves,
            COALESCE(s.project_name, ep.name) AS project_name,
            COALESCE(s.task_name, et.name) AS task_name,
            s.os_platform
          FROM activity_sessions s
          LEFT JOIN external_projects ep ON ep.id = s.external_project_id
          LEFT JOIN external_tasks et ON et.id = s.external_task_id
          WHERE s.user_id = ${userId} ${fromFilter} ${toFilter}
          ORDER BY s.started_at DESC
          LIMIT ${query.limit} OFFSET ${query.offset}`
    );

    return reply.send({ data: Array.from(sessions) });
  });

  // Admin: activity by date — all users breakdown for a specific date
  app.get("/api/admin/activity/date/:date", { preHandler: admin }, async (request, reply) => {
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(request.params);

    const result = await db.execute<{
      user_id: string;
      full_name: string;
      email: string;
      total_active_seconds: number;
      total_idle_seconds: number;
      total_keystrokes: number;
      total_file_saves: number;
      session_count: number;
      project_names: string;
      task_names: string;
    }>(
      sql`SELECT
            u.id AS user_id, u.full_name, u.email,
            COALESCE(SUM(s.active_seconds), 0)::int AS total_active_seconds,
            COALESCE(SUM(s.idle_seconds), 0)::int AS total_idle_seconds,
            COALESCE(SUM(s.total_keystrokes), 0)::int AS total_keystrokes,
            COALESCE(SUM(s.total_file_saves), 0)::int AS total_file_saves,
            COUNT(*)::int AS session_count,
            STRING_AGG(DISTINCT COALESCE(s.project_name, ep.name), ', ') AS project_names,
            STRING_AGG(DISTINCT COALESCE(s.task_name, et.name), ', ') AS task_names
          FROM activity_sessions s
          JOIN users u ON u.id = s.user_id
          LEFT JOIN external_projects ep ON ep.id = s.external_project_id
          LEFT JOIN external_tasks et ON et.id = s.external_task_id
          WHERE date(s.started_at) = ${date}::date
          GROUP BY u.id, u.full_name, u.email
          ORDER BY total_active_seconds DESC`
    );

    return reply.send({ data: Array.from(result) });
  });

  // Admin: AI usage per developer per day with task breakdown
  app.get("/api/admin/ai-usage/user/:userId/daily", { preHandler: admin }, async (request, reply) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const query = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }).parse(request.query);

    const fromFilter = query.from ? sql`AND a.date >= ${query.from.slice(0, 10)}` : sql``;
    const toFilter = query.to ? sql`AND a.date <= ${query.to.slice(0, 10)}` : sql``;

    const daily = await db.execute<{
      date: string;
      total_requests: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cost_usd: string;
      model_breakdown: unknown;
    }>(
      sql`SELECT
            a.date,
            a.total_requests,
            a.total_input_tokens,
            a.total_output_tokens,
            a.total_cost_usd,
            a.model_breakdown
          FROM ai_usage_daily a
          WHERE a.user_id = ${userId} ${fromFilter} ${toFilter}
          ORDER BY a.date DESC
          LIMIT ${query.limit}`
    );

    return reply.send({ data: Array.from(daily) });
  });
}
