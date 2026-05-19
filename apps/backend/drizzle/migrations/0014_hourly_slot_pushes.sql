-- Track which (user, sub_project, slot_start) tuples we've already pushed
-- to chat-ui's /hourly-billing/snapshots, plus a snapshot of session
-- counters at the moment of the push.
--
-- Two reasons to keep this state on our side instead of relying purely on
-- chat-ui's dedup-by-slot_id:
--
-- 1. Delta counters. activity_sessions.total_keystrokes is cumulative for
--    the whole session. chat-ui expects per-slot hits. The previous row's
--    `keystrokes_at_push` lets us compute (current_total - last_total) as
--    the delta for the current slot push, without storing per-slot state
--    on the session itself.
--
-- 2. Retry-safety. If chat-ui returns 5xx we DON'T insert the row; the
--    next screenshot in the same slot will see no pushed-row and retry.
--    Successful pushes record the row so subsequent screenshots in the
--    same slot become no-ops on our side (no redundant HTTP to chat-ui).
--
-- Slot bucketing is intentionally fixed at 10 minutes here — chat-ui's
-- /hourly-billing/status returns slot_duration_minutes dynamically, but
-- the contract surface (slot_id = `<sp>:<lancer>:<iso>`) only cares that
-- slot_start lands on a consistent boundary. 10 min matches today's
-- chat-ui default; if the platform changes the slot length, update the
-- SLOT_DURATION_MS constant in HourlyBillingPusher and the next slot
-- naturally aligns to the new boundary.
CREATE TABLE IF NOT EXISTS hourly_slot_pushes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sub_project_id UUID NOT NULL,
  slot_start TIMESTAMPTZ NOT NULL,
  lancer_user_id TEXT NOT NULL,
  keystrokes_at_push INTEGER NOT NULL DEFAULT 0,
  mouse_hits_at_push INTEGER NOT NULL DEFAULT 0,
  screenshot_id UUID REFERENCES screenshots(id) ON DELETE SET NULL,
  pushed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, sub_project_id, slot_start)
);

-- Index for the "latest pushed slot for this (user, sub_project)" lookup
-- used during delta computation on the next push.
CREATE INDEX IF NOT EXISTS idx_hourly_slot_pushes_latest
  ON hourly_slot_pushes (user_id, sub_project_id, slot_start DESC);
