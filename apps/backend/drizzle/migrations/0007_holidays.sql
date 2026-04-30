CREATE TABLE IF NOT EXISTS "holidays" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "date"       date NOT NULL UNIQUE,
  "name"       varchar(100) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_holidays_date" ON "holidays" ("date");
