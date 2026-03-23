import type { Database } from "../config/database.js";
import { externalProjects, externalTasks } from "../models/index.js";
import { sql } from "drizzle-orm";

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
   * Find the external user ID for a given display name.
   * Scans the assignedUsers of all tasks for a matching name.
   * Returns the best match (exact first, then case-insensitive).
   */
  /**
   * Find ALL external users whose display name matches fullName (case-insensitive).
   * Returns multiple candidates — caller must handle duplicates by prompting the user.
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
