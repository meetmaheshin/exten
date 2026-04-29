ALTER TABLE "activity_sessions" ADD COLUMN IF NOT EXISTS "project_name" varchar(200);
ALTER TABLE "activity_sessions" ADD COLUMN IF NOT EXISTS "task_name" varchar(200);
