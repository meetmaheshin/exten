-- Track mouse / focus event count per session, alongside total_keystrokes.
-- VS Code's extension API can't see real mouse moves, but editor-focus
-- changes are a reasonable proxy ("user is interacting with the IDE").
-- Surface on /me daily breakdown so managers see two attention signals.
--
-- Optional column — older clients (pre-v0.2.21) won't send mouseEventCount
-- in their heartbeat, so the column defaults to 0 and accumulates from
-- any future clients that do.

ALTER TABLE activity_sessions
  ADD COLUMN IF NOT EXISTS total_mouse_events INTEGER NOT NULL DEFAULT 0;
