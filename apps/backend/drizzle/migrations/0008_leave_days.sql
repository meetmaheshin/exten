CREATE TABLE IF NOT EXISTS "leave_days" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"     uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "date"        date NOT NULL,
  "leave_type"  varchar(20) NOT NULL DEFAULT 'full',
  "note"        varchar(500),
  "approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "leave_days_user_date_unique" UNIQUE ("user_id", "date")
);

CREATE INDEX IF NOT EXISTS "idx_leave_days_user" ON "leave_days" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_leave_days_date" ON "leave_days" ("date");
