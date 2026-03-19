import {
  pgTable,
  integer,
  varchar,
  text,
  boolean,
  jsonb,
  numeric,
  timestamp,
  index,
  bigint,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Cached copy of projects from the Ailancers platform (habitnetwork API).
 * Synced periodically via /api/admin/sync/projects.
 * Uses integer PKs matching the external system's IDs.
 */
export const externalProjects = pgTable(
  "external_projects",
  {
    // External platform ID (not our UUID)
    id: integer("id").primaryKey(),
    name: varchar("name", { length: 512 }).notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    isClosed: boolean("is_closed").notNull().default(false),
    dateStart: varchar("date_start", { length: 20 }),
    dateEnd: varchar("date_end", { length: 20 }),
    stageId: integer("stage_id"),
    stageName: varchar("stage_name", { length: 100 }),
    // Primary owner user (external user_id object)
    ownerId: integer("owner_id"),
    ownerName: varchar("owner_name", { length: 255 }),
    // Client/partner
    partnerId: integer("partner_id"),
    partnerName: varchar("partner_name", { length: 255 }),
    // Project managers array (stored as JSONB: [{id, name}])
    projectManagers: jsonb("project_managers").notNull().default([]),
    // Assignee external IDs array (integers)
    assigneeIds: jsonb("assignee_ids").notNull().default([]),
    // Financial
    totalValueUsd: numeric("total_value_usd", { precision: 12, scale: 2 }),
    receivedUsd: numeric("received_usd", { precision: 12, scale: 2 }),
    allocatedHours: numeric("allocated_hours", { precision: 10, scale: 2 }),
    businessUnit: varchar("business_unit", { length: 100 }),
    // Raw properties blob for anything extra
    rawProperties: jsonb("raw_properties").default({}),
    taskCount: integer("task_count").notNull().default(0),
    milestoneCount: integer("milestone_count").notNull().default(0),
    // When we last synced this project from the external API
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_ext_projects_active").on(table.active),
    index("idx_ext_projects_stage").on(table.stageId),
    index("idx_ext_projects_owner").on(table.ownerId),
    index("idx_ext_projects_synced").on(table.lastSyncedAt),
  ]
);

/**
 * Cached copy of tasks from the external platform.
 * Each task belongs to one external project.
 */
export const externalTasks = pgTable(
  "external_tasks",
  {
    id: integer("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => externalProjects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 512 }).notNull(),
    description: text("description"),
    state: varchar("state", { length: 50 }),
    priority: varchar("priority", { length: 10 }).default("0"),
    dateDeadline: timestamp("date_deadline", { withTimezone: true }),
    dateAssign: timestamp("date_assign", { withTimezone: true }),
    stageId: integer("stage_id"),
    stageName: varchar("stage_name", { length: 100 }),
    milestoneId: integer("milestone_id"),
    milestoneName: varchar("milestone_name", { length: 255 }),
    isInternalProject: boolean("is_internal_project").notNull().default(false),
    // Assigned users: [{id, name}]
    assignedUsers: jsonb("assigned_users").notNull().default([]),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_ext_tasks_project").on(table.projectId),
    index("idx_ext_tasks_state").on(table.state),
    index("idx_ext_tasks_stage").on(table.stageId),
    index("idx_ext_tasks_deadline").on(table.dateDeadline),
  ]
);

/**
 * Maps our internal users (UUID) to their external platform user ID (integer).
 * Populated during login by matching fullName against the external assignee list.
 * Also caches the external user's display name for fast lookups.
 */
export const externalUserMappings = pgTable(
  "external_user_mappings",
  {
    // Our internal user UUID
    userId: varchar("user_id", { length: 36 }).primaryKey(),
    // Their ID in the external habitnetwork system
    externalUserId: integer("external_user_id").notNull(),
    externalUserName: varchar("external_user_name", { length: 255 }).notNull(),
    // Confidence: "exact" (name match) | "manual" (admin-set)
    matchType: varchar("match_type", { length: 20 }).notNull().default("exact"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_ext_user_map_external").on(table.externalUserId),
  ]
);

export const externalProjectsRelations = relations(externalProjects, ({ many }) => ({
  tasks: many(externalTasks),
}));

export const externalTasksRelations = relations(externalTasks, ({ one }) => ({
  project: one(externalProjects, {
    fields: [externalTasks.projectId],
    references: [externalProjects.id],
  }),
}));
