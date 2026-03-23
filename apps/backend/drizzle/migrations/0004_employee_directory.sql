-- Employee directory: maps external platform user IDs to emails
-- Imported from HR CSV data. Used for email-based identity matching.

CREATE TABLE IF NOT EXISTS "employee_directory" (
  "external_user_id" integer PRIMARY KEY,
  "employee_name" varchar(255) NOT NULL,
  "email" varchar(255) NOT NULL,
  "department" varchar(100),
  "job_position" varchar(255),
  "manager_name" varchar(255),
  "company" varchar(255),
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_emp_dir_email" ON "employee_directory" ("email");
CREATE INDEX IF NOT EXISTS "idx_emp_dir_name" ON "employee_directory" ("employee_name");
