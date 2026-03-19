-- Migration: external projects/tasks integration + activity session tagging

-- ────────────────────────────────────────────────────────────────
-- external_projects: cached copy of projects from the platform API
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "external_projects" (
  "id"               integer PRIMARY KEY,
  "name"             varchar(512) NOT NULL,
  "description"      text,
  "active"           boolean NOT NULL DEFAULT true,
  "is_closed"        boolean NOT NULL DEFAULT false,
  "date_start"       varchar(20),
  "date_end"         varchar(20),
  "stage_id"         integer,
  "stage_name"       varchar(100),
  "owner_id"         integer,
  "owner_name"       varchar(255),
  "partner_id"       integer,
  "partner_name"     varchar(255),
  "project_managers" jsonb NOT NULL DEFAULT '[]',
  "assignee_ids"     jsonb NOT NULL DEFAULT '[]',
  "total_value_usd"  numeric(12,2),
  "received_usd"     numeric(12,2),
  "allocated_hours"  numeric(10,2),
  "business_unit"    varchar(100),
  "raw_properties"   jsonb DEFAULT '{}',
  "task_count"       integer NOT NULL DEFAULT 0,
  "milestone_count"  integer NOT NULL DEFAULT 0,
  "last_synced_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_ext_projects_active"  ON "external_projects" ("active");
CREATE INDEX IF NOT EXISTS "idx_ext_projects_stage"   ON "external_projects" ("stage_id");
CREATE INDEX IF NOT EXISTS "idx_ext_projects_owner"   ON "external_projects" ("owner_id");
CREATE INDEX IF NOT EXISTS "idx_ext_projects_synced"  ON "external_projects" ("last_synced_at");

-- Full-text search index on project name for fast lookup
CREATE INDEX IF NOT EXISTS "idx_ext_projects_name_trgm"
  ON "external_projects" USING gin (name gin_trgm_ops);

-- ────────────────────────────────────────────────────────────────
-- external_tasks
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "external_tasks" (
  "id"                   integer PRIMARY KEY,
  "project_id"           integer NOT NULL REFERENCES "external_projects"("id") ON DELETE CASCADE,
  "name"                 varchar(512) NOT NULL,
  "description"          text,
  "state"                varchar(50),
  "priority"             varchar(10) DEFAULT '0',
  "date_deadline"        timestamp with time zone,
  "date_assign"          timestamp with time zone,
  "stage_id"             integer,
  "stage_name"           varchar(100),
  "milestone_id"         integer,
  "milestone_name"       varchar(255),
  "is_internal_project"  boolean NOT NULL DEFAULT false,
  "assigned_users"       jsonb NOT NULL DEFAULT '[]',
  "last_synced_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"           timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_ext_tasks_project"   ON "external_tasks" ("project_id");
CREATE INDEX IF NOT EXISTS "idx_ext_tasks_state"     ON "external_tasks" ("state");
CREATE INDEX IF NOT EXISTS "idx_ext_tasks_stage"     ON "external_tasks" ("stage_id");
CREATE INDEX IF NOT EXISTS "idx_ext_tasks_deadline"  ON "external_tasks" ("date_deadline");

-- GIN index for fast JSONB query on assigned_users array
CREATE INDEX IF NOT EXISTS "idx_ext_tasks_assigned_users"
  ON "external_tasks" USING gin ("assigned_users");

-- ────────────────────────────────────────────────────────────────
-- external_user_mappings: our users ↔ external platform user IDs
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "external_user_mappings" (
  "user_id"            varchar(36) PRIMARY KEY,
  "external_user_id"   integer NOT NULL,
  "external_user_name" varchar(255) NOT NULL,
  "match_type"         varchar(20) NOT NULL DEFAULT 'exact',
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_ext_user_map_external" ON "external_user_mappings" ("external_user_id");

-- ────────────────────────────────────────────────────────────────
-- Add external project/task reference columns to activity_sessions
-- ────────────────────────────────────────────────────────────────
ALTER TABLE "activity_sessions"
  ADD COLUMN IF NOT EXISTS "external_project_id" integer REFERENCES "external_projects"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "external_task_id"    integer REFERENCES "external_tasks"("id")    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_activity_ext_project" ON "activity_sessions" ("external_project_id");
CREATE INDEX IF NOT EXISTS "idx_activity_ext_task"    ON "activity_sessions" ("external_task_id");

-- ────────────────────────────────────────────────────────────────
-- Partial index: active sessions (no endedAt) for live status queries
-- ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_activity_sessions_active"
  ON "activity_sessions" ("user_id", "started_at")
  WHERE "ended_at" IS NULL;

-- ────────────────────────────────────────────────────────────────
-- Enable pg_trgm for fuzzy name matching (used in user mapping)
-- ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;
