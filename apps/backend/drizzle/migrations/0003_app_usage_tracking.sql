ALTER TABLE "activity_sessions" ADD COLUMN IF NOT EXISTS "app_usage" jsonb DEFAULT '{}'::jsonb;
