ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "employment_status" varchar(20) NOT NULL DEFAULT 'active';

-- Existing users keep the default. Admins promote/demote on the Users page.
-- Valid values: 'active' | 'on_leave' | 'notice' | 'resigned' | 'maternity'
-- (enforced at the application layer, not via Postgres enum, so adding new
-- statuses doesn't require a migration)
