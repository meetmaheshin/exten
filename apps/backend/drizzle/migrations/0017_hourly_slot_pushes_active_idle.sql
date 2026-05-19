-- Snapshot active_seconds / idle_seconds at the moment of each push so the
-- NEXT push for the same (user, sub_project) can compute per-slot deltas,
-- not session-cumulative ratios.
--
-- Background: the HourlyBillingPusher's `activity_percent` fallback (used
-- when the desktop tracker can't capture OS-level kb/mouse hits) was
-- originally based on session-cumulative active/(active+idle) — which over
-- a 2h session converges to a flat average and stops reflecting "is the
-- user engaged right now." Snapshot here mirrors the pattern we already
-- use for `keystrokes_at_push` / `mouse_hits_at_push`: the delta between
-- consecutive pushes equals the kb/idle/active accumulated during THAT
-- slot.
--
-- Existing rows: default 0. Their next push will compute deltas against 0,
-- which over-credits the first new slot per (user, sub_project) by the
-- session's pre-migration accumulation. Acceptable — happens once per
-- user post-deploy and clamps at 100% via the existing min() in the
-- pusher.

ALTER TABLE hourly_slot_pushes
  ADD COLUMN IF NOT EXISTS active_seconds_at_push INTEGER NOT NULL DEFAULT 0;

ALTER TABLE hourly_slot_pushes
  ADD COLUMN IF NOT EXISTS idle_seconds_at_push INTEGER NOT NULL DEFAULT 0;
