-- Soft-delete + audit columns for screenshots.
--
-- Until now `DELETE /api/telemetry/screenshots/:id` hard-deleted the row and
-- subtracted 300s from `active_seconds` via deductTimeForScreenshot(). That
-- worked but had three problems for payroll:
--   1) The 300s deduction was approximate (could over-/under-correct on edge
--      sessions) instead of letting the actual screenshot count drive billing.
--   2) Hard-delete left no audit trail — a payroll dispute is unwinnable when
--      you can't prove what was there yesterday.
--   3) `active_seconds` was the headline number, but it could grow without
--      any matching screenshot (network failure, lock screen, capture error)
--      — letting users get paid for time we have no proof of.
--
-- After this migration, payroll computes "billable seconds" as
--   count(screenshots WHERE deleted_at IS NULL) * 300_seconds
-- so:
--   - missing screenshots automatically lose pay (no separate logic needed)
--   - deleting a screenshot is reversible and auditable (deleted_at + deleted_by)
--   - HR can recover from accidental deletes by clearing deleted_at

ALTER TABLE screenshots
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason VARCHAR(500);

-- Index so the most common payroll query (WHERE deleted_at IS NULL) stays fast.
-- Partial index — only rows where deleted_at IS NULL get indexed, since
-- payroll never asks about deleted rows.
CREATE INDEX IF NOT EXISTS idx_screenshots_live_by_user_date
  ON screenshots (user_id, captured_at)
  WHERE deleted_at IS NULL;
