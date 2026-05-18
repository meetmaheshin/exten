-- Track the last heartbeat timestamp directly on the session row so the
-- wall-clock clamp (telemetry.routes.ts heartbeat handler) doesn't need to
-- query telemetry_events on every tick.
--
-- Why this matters: the previous design INSERTed one row into
-- telemetry_events per heartbeat per user — roughly 50 users × 60 heartbeats/h
-- × 8h/day = 24,000 rows/day, growing forever. Nothing in the dashboard
-- ever read those rows; they existed only to give the wall-clock clamp an
-- anchor for "when did the last heartbeat land." Moving that anchor onto
-- activity_sessions (which is already being UPDATEd anyway) eliminates the
-- INSERT path entirely.
--
-- See migration 0013_drop_heartbeat_events.sql for the corresponding
-- one-time cleanup of accumulated heartbeat rows.

ALTER TABLE activity_sessions
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

-- Backfill: for any active session that doesn't have a last_heartbeat_at
-- yet, seed it from the most recent heartbeat event we have on file.
-- If there are no heartbeats (somehow), fall back to started_at. This
-- keeps the first post-deploy clamp from over-clamping the first heartbeat.
UPDATE activity_sessions s
SET last_heartbeat_at = COALESCE(
  (SELECT MAX(te.timestamp)
     FROM telemetry_events te
    WHERE te.session_id = s.id
      AND te.event_type = 'heartbeat'),
  s.started_at
)
WHERE s.last_heartbeat_at IS NULL;
