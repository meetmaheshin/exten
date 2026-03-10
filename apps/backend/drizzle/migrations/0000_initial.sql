-- Initial migration: create all tables

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" varchar(255) NOT NULL UNIQUE,
  "password_hash" varchar(255) NOT NULL,
  "full_name" varchar(255) NOT NULL,
  "role" varchar(20) NOT NULL DEFAULT 'developer',
  "team" varchar(100),
  "is_active" boolean NOT NULL DEFAULT true,
  "avatar_url" varchar(512),
  "monthly_budget_usd" numeric(10,2),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users" ("email");
CREATE INDEX IF NOT EXISTS "idx_users_role" ON "users" ("role");
CREATE INDEX IF NOT EXISTS "idx_users_team" ON "users" ("team");

-- Projects
CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(255) NOT NULL,
  "slug" varchar(100) NOT NULL UNIQUE,
  "description" text,
  "monthly_budget_usd" numeric(10,2),
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_projects_slug" ON "projects" ("slug");

-- User-Project junction
CREATE TABLE IF NOT EXISTS "user_projects" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "role" varchar(20) DEFAULT 'member',
  "joined_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "project_id")
);

-- Conversations
CREATE TABLE IF NOT EXISTS "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "title" varchar(500),
  "model" varchar(100) NOT NULL DEFAULT 'claude-sonnet-4-6',
  "mode" varchar(20) NOT NULL DEFAULT 'chat',
  "is_archived" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_conversations_user" ON "conversations" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_conversations_project" ON "conversations" ("project_id");
CREATE INDEX IF NOT EXISTS "idx_conversations_created" ON "conversations" ("created_at");

-- Messages
CREATE TABLE IF NOT EXISTS "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "role" varchar(20) NOT NULL,
  "content" text NOT NULL,
  "content_type" varchar(20) NOT NULL DEFAULT 'text',
  "input_tokens" integer,
  "output_tokens" integer,
  "cost_usd" numeric(10,6),
  "model" varchar(100),
  "latency_ms" integer,
  "error" text,
  "tool_calls" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_messages_conversation" ON "messages" ("conversation_id");
CREATE INDEX IF NOT EXISTS "idx_messages_created" ON "messages" ("created_at");

-- Refresh Tokens
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" varchar(255) NOT NULL UNIQUE,
  "device_info" varchar(500),
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_user" ON "refresh_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_hash" ON "refresh_tokens" ("token_hash");

-- Activity Sessions
CREATE TABLE IF NOT EXISTS "activity_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "started_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "active_seconds" integer NOT NULL DEFAULT 0,
  "idle_seconds" integer NOT NULL DEFAULT 0,
  "total_keystrokes" integer NOT NULL DEFAULT 0,
  "total_file_saves" integer NOT NULL DEFAULT 0,
  "total_file_changes" integer NOT NULL DEFAULT 0,
  "files_touched" jsonb DEFAULT '[]',
  "languages_used" jsonb DEFAULT '{}',
  "editor_version" varchar(50),
  "extension_version" varchar(20),
  "os_platform" varchar(30),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_activity_user" ON "activity_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_activity_project" ON "activity_sessions" ("project_id");
CREATE INDEX IF NOT EXISTS "idx_activity_started" ON "activity_sessions" ("started_at");
CREATE INDEX IF NOT EXISTS "idx_activity_user_date" ON "activity_sessions" ("user_id", "started_at");

-- Telemetry Events
CREATE TABLE IF NOT EXISTS "telemetry_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_id" uuid REFERENCES "activity_sessions"("id") ON DELETE SET NULL,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "event_type" varchar(50) NOT NULL,
  "event_data" jsonb NOT NULL DEFAULT '{}',
  "timestamp" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_telemetry_user" ON "telemetry_events" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_telemetry_type" ON "telemetry_events" ("event_type");
CREATE INDEX IF NOT EXISTS "idx_telemetry_timestamp" ON "telemetry_events" ("timestamp");

-- AI Usage Daily (aggregated)
CREATE TABLE IF NOT EXISTS "ai_usage_daily" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "date" date NOT NULL,
  "total_requests" integer NOT NULL DEFAULT 0,
  "total_input_tokens" integer NOT NULL DEFAULT 0,
  "total_output_tokens" integer NOT NULL DEFAULT 0,
  "total_cost_usd" numeric(10,4) NOT NULL DEFAULT 0,
  "model_breakdown" jsonb DEFAULT '{}',
  CONSTRAINT "uq_ai_usage_user_project_date" UNIQUE ("user_id", "project_id", "date")
);
CREATE INDEX IF NOT EXISTS "idx_ai_usage_user_date" ON "ai_usage_daily" ("user_id", "date");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_project_date" ON "ai_usage_daily" ("project_id", "date");

-- Budget Alerts
CREATE TABLE IF NOT EXISTS "budget_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "target_type" varchar(20) NOT NULL,
  "target_id" uuid NOT NULL,
  "threshold_pct" integer NOT NULL,
  "triggered_at" timestamp with time zone,
  "acknowledged_at" timestamp with time zone,
  "month" date NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Screenshots
CREATE TABLE IF NOT EXISTS "screenshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_id" uuid REFERENCES "activity_sessions"("id") ON DELETE SET NULL,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "filename" varchar(255) NOT NULL,
  "storage_path" text NOT NULL,
  "file_size_bytes" integer NOT NULL DEFAULT 0,
  "metadata" jsonb DEFAULT '{}',
  "captured_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_screenshots_user" ON "screenshots" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_screenshots_session" ON "screenshots" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_screenshots_captured" ON "screenshots" ("captured_at");
CREATE INDEX IF NOT EXISTS "idx_screenshots_user_date" ON "screenshots" ("user_id", "captured_at");
