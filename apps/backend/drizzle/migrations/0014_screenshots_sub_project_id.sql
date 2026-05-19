-- Add sub_project_id to screenshots so the chat-ui Ailancers team can
-- map every screenshot to its sub-project for billing/attribution.
--
-- Without this column they were stuck inferring sub-project from the
-- session's `subProjectId` field on activity_sessions — fragile because
-- a single session can theoretically cover multiple projects (the user
-- can switch mid-session). One column on `screenshots` directly is the
-- contract chat-ui asked for.
--
-- Going-forward only. Historical screenshots stay NULL. The capture
-- pipeline will refuse to upload when no sub-project is selected (see
-- ScreenCaptureService and the desktop equivalent), so all NEW rows
-- arrive with a non-null value.
--
-- The column is a free-form varchar to mirror how every other place in
-- the codebase carries sub_project_id (UUIDs from the v2 platform).

ALTER TABLE screenshots
  ADD COLUMN IF NOT EXISTS sub_project_id VARCHAR(64);

-- Index for chat-ui's expected query pattern:
--   SELECT ... FROM screenshots
--   WHERE sub_project_id = $1 AND captured_at BETWEEN $2 AND $3 AND deleted_at IS NULL
CREATE INDEX IF NOT EXISTS idx_screenshots_sub_project_date
  ON screenshots (sub_project_id, captured_at)
  WHERE deleted_at IS NULL AND sub_project_id IS NOT NULL;
