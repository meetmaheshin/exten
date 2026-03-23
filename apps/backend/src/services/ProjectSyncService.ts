import type { Database } from "../config/database.js";
import { externalProjects, externalTasks, employeeDirectory } from "../models/index.js";
import { sql, eq } from "drizzle-orm";

const PLATFORM_API_URL = "https://mailerai.habitnetwork.xyz/api/project-info";

interface PlatformUser { id: number; name: string; }
interface PlatformTask {
  id: number;
  name: string;
  description: string;
  state: string;
  priority: string;
  date_deadline: string | null;
  date_assign: string | null;
  assigned_users: PlatformUser[];
  milestone_id: number | null;
  milestone_name: string | null;
  is_internal_project: boolean;
  deadline_change_reason: string;
  stage_id: number | null;
  stage_name: string | null;
}
interface PlatformProject {
  id: number;
  name: string;
  description: string;
  active: boolean;
  is_closed: boolean;
  date: string | null;
  date_start: string | null;
  stage_id: number;
  stage_name: string;
  user_id: PlatformUser | null;
  partner_id: PlatformUser | null;
  project_managers: PlatformUser[];
  properties: Record<string, unknown>;
  allocated_hours: number;
  tasks: PlatformTask[];
  task_count: number;
  milestone_count: number;
}

export interface SyncResult {
  projectsUpserted: number;
  tasksUpserted: number;
  errors: string[];
  durationMs: number;
}

export class ProjectSyncService {
  constructor(private db: Database) {}

  async sync(): Promise<SyncResult> {
    const startedAt = Date.now();
    const errors: string[] = [];

    // Fetch from external API with a 30s timeout
    let platformData: { projects: PlatformProject[] };
    try {
      const resp = await fetch(PLATFORM_API_URL, {
        signal: AbortSignal.timeout(30_000),
        headers: { "Accept": "application/json" },
      });
      if (!resp.ok) throw new Error(`API responded ${resp.status}`);
      platformData = await resp.json() as { projects: PlatformProject[] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { projectsUpserted: 0, tasksUpserted: 0, errors: [`Fetch failed: ${msg}`], durationMs: Date.now() - startedAt };
    }

    const projects = platformData.projects ?? [];
    let projectsUpserted = 0;
    let tasksUpserted = 0;

    // Upsert in batches to avoid huge single transactions
    const BATCH = 50;
    for (let i = 0; i < projects.length; i += BATCH) {
      const batch = projects.slice(i, i + BATCH);

      try {
        // Upsert projects
        const projectRows = batch.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description || null,
          active: p.active,
          isClosed: p.is_closed,
          dateStart: p.date_start || null,
          dateEnd: p.date || null,
          stageId: p.stage_id || null,
          stageName: p.stage_name || null,
          ownerId: p.user_id?.id ?? null,
          ownerName: p.user_id?.name ?? null,
          partnerId: p.partner_id?.id ?? null,
          partnerName: p.partner_id?.name ?? null,
          projectManagers: p.project_managers ?? [],
          assigneeIds: Array.isArray(p.properties?.Assignees) ? p.properties.Assignees : [],
          totalValueUsd: typeof p.properties?.["Total Value"] === "number"
            ? String(p.properties["Total Value"])
            : null,
          receivedUsd: typeof p.properties?.["Received"] === "number"
            ? String(p.properties["Received"])
            : null,
          allocatedHours: p.allocated_hours ? String(p.allocated_hours) : null,
          businessUnit: typeof p.properties?.["Business Unit"] === "string"
            ? p.properties["Business Unit"]
            : null,
          rawProperties: p.properties ?? {},
          taskCount: p.task_count ?? 0,
          milestoneCount: p.milestone_count ?? 0,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        }));

        await this.db
          .insert(externalProjects)
          .values(projectRows)
          .onConflictDoUpdate({
            target: externalProjects.id,
            set: {
              name: externalProjects.name,
              description: externalProjects.description,
              active: externalProjects.active,
              isClosed: externalProjects.isClosed,
              dateStart: externalProjects.dateStart,
              dateEnd: externalProjects.dateEnd,
              stageId: externalProjects.stageId,
              stageName: externalProjects.stageName,
              ownerId: externalProjects.ownerId,
              ownerName: externalProjects.ownerName,
              partnerId: externalProjects.partnerId,
              partnerName: externalProjects.partnerName,
              projectManagers: externalProjects.projectManagers,
              assigneeIds: externalProjects.assigneeIds,
              totalValueUsd: externalProjects.totalValueUsd,
              receivedUsd: externalProjects.receivedUsd,
              allocatedHours: externalProjects.allocatedHours,
              businessUnit: externalProjects.businessUnit,
              rawProperties: externalProjects.rawProperties,
              taskCount: externalProjects.taskCount,
              milestoneCount: externalProjects.milestoneCount,
              lastSyncedAt: externalProjects.lastSyncedAt,
              updatedAt: externalProjects.updatedAt,
            },
          });
        projectsUpserted += batch.length;

        // Upsert tasks for this batch
        const allTasks = batch.flatMap((p) =>
          (p.tasks ?? []).map((t) => ({ ...t, _projectId: p.id }))
        );
        if (allTasks.length > 0) {
          const taskRows = allTasks.map((t) => ({
            id: t.id,
            projectId: t._projectId,
            name: t.name,
            description: t.description || null,
            state: t.state || null,
            priority: t.priority ?? "0",
            dateDeadline: t.date_deadline ? new Date(t.date_deadline) : null,
            dateAssign: t.date_assign ? new Date(t.date_assign) : null,
            stageId: t.stage_id ?? null,
            stageName: t.stage_name ?? null,
            milestoneId: t.milestone_id ?? null,
            milestoneName: t.milestone_name ?? null,
            isInternalProject: t.is_internal_project ?? false,
            assignedUsers: t.assigned_users ?? [],
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          }));

          // Sub-batch tasks to stay within postgres parameter limits
          const TASK_BATCH = 100;
          for (let j = 0; j < taskRows.length; j += TASK_BATCH) {
            await this.db
              .insert(externalTasks)
              .values(taskRows.slice(j, j + TASK_BATCH))
              .onConflictDoUpdate({
                target: externalTasks.id,
                set: {
                  projectId: externalTasks.projectId,
                  name: externalTasks.name,
                  description: externalTasks.description,
                  state: externalTasks.state,
                  priority: externalTasks.priority,
                  dateDeadline: externalTasks.dateDeadline,
                  dateAssign: externalTasks.dateAssign,
                  stageId: externalTasks.stageId,
                  stageName: externalTasks.stageName,
                  milestoneId: externalTasks.milestoneId,
                  milestoneName: externalTasks.milestoneName,
                  isInternalProject: externalTasks.isInternalProject,
                  assignedUsers: externalTasks.assignedUsers,
                  lastSyncedAt: externalTasks.lastSyncedAt,
                  updatedAt: externalTasks.updatedAt,
                },
              });
          }
          tasksUpserted += allTasks.length;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Batch ${i}-${i + BATCH}: ${msg}`);
      }
    }

    return {
      projectsUpserted,
      tasksUpserted,
      errors,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Find external user ID by email using the employee directory.
   * This is the primary matching method — reliable and unique.
   */
  async findExternalUserByEmail(email: string): Promise<{ id: number; name: string } | null> {
    const emailLower = email.trim().toLowerCase();
    const [row] = await this.db
      .select({ externalUserId: employeeDirectory.externalUserId, employeeName: employeeDirectory.employeeName })
      .from(employeeDirectory)
      .where(sql`lower(${employeeDirectory.email}) = ${emailLower}`)
      .limit(1);

    if (row) {
      return { id: row.externalUserId, name: row.employeeName };
    }
    return null;
  }

  /**
   * Import employee directory from CSV data (parsed as array of objects).
   * Each row needs: externalUserId, employeeName, email, and optional department/company/etc.
   */
  async importEmployeeDirectory(rows: Array<{
    externalUserId: number;
    employeeName: string;
    email: string;
    department?: string;
    jobPosition?: string;
    managerName?: string;
    company?: string;
    active?: boolean;
  }>): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    const BATCH = 50;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
        .filter((r) => r.externalUserId && r.email && r.email !== "N/A" && r.email !== "test");

      if (batch.length === 0) { skipped += BATCH; continue; }

      const values = batch.map((r) => ({
        externalUserId: r.externalUserId,
        employeeName: r.employeeName,
        email: r.email.toLowerCase().trim(),
        department: r.department || null,
        jobPosition: r.jobPosition || null,
        managerName: r.managerName || null,
        company: r.company || null,
        active: r.active ?? true,
        updatedAt: new Date(),
      }));

      await this.db
        .insert(employeeDirectory)
        .values(values)
        .onConflictDoUpdate({
          target: employeeDirectory.externalUserId,
          set: {
            employeeName: sql`excluded.employee_name`,
            email: sql`excluded.email`,
            department: sql`excluded.department`,
            jobPosition: sql`excluded.job_position`,
            managerName: sql`excluded.manager_name`,
            company: sql`excluded.company`,
            active: sql`excluded.active`,
            updatedAt: sql`now()`,
          },
        });

      imported += batch.length;
      skipped += (rows.slice(i, i + BATCH).length - batch.length);
    }

    return { imported, skipped };
  }

  /**
   * Find ALL external users whose display name matches fullName (case-insensitive).
   * Fallback when email matching fails. Returns multiple candidates.
   */
  async findExternalUserCandidatesByName(fullName: string): Promise<Array<{ id: number; name: string }>> {
    const nameLower = fullName.trim().toLowerCase();

    const taskResult = await this.db.execute<{ external_user_id: number; external_user_name: string }>(
      sql`SELECT DISTINCT
            (u->>'id')::int  AS external_user_id,
            u->>'name'       AS external_user_name
          FROM external_tasks,
               jsonb_array_elements(assigned_users) AS u
          WHERE lower(u->>'name') = ${nameLower}`
    );
    const taskRows = Array.from(taskResult);
    if (taskRows.length > 0) {
      return taskRows.map((r) => ({ id: r.external_user_id, name: r.external_user_name }));
    }

    // Fallback: project owners
    const ownerResult = await this.db.execute<{ external_user_id: number; external_user_name: string }>(
      sql`SELECT DISTINCT
            owner_id    AS external_user_id,
            owner_name  AS external_user_name
          FROM external_projects
          WHERE lower(owner_name) = ${nameLower}`
    );
    return Array.from(ownerResult).map((r) => ({ id: r.external_user_id, name: r.external_user_name }));
  }
}
