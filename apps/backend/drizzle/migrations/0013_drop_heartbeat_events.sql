-- One-time cleanup: delete accumulated heartbeat rows from telemetry_events.
--
-- After migration 0012 the backend no longer INSERTs heartbeat rows. This
-- migration drops the historical buildup. Run safely on prod — nothing in
-- the codebase reads heartbeat-type events (the wall-clock clamp now uses
-- activity_sessions.last_heartbeat_at). Other event types (e.g. future
-- audit events) are preserved.
--
-- Estimated impact: depending on how long the heartbeat INSERT has been
-- running, this can free GBs of table+index storage. Run during a low-traffic
-- window if the table is large — DELETE on millions of rows can be slow.
-- If the cleanup is too painful in one go, you can chunk it manually:
--   DELETE FROM telemetry_events
--     WHERE event_type = 'heartbeat'
--       AND timestamp < now() - interval '7 days'
--       AND id IN (SELECT id FROM telemetry_events WHERE event_type='heartbeat' LIMIT 100000);
-- ...and loop.

DELETE FROM telemetry_events WHERE event_type = 'heartbeat';

-- Reclaim space + refresh planner stats so future queries pick the right
-- indexes. VACUUM FULL would be more aggressive but locks the table; ANALYZE
-- is non-blocking and good enough for normal usage.
ANALYZE telemetry_events;
