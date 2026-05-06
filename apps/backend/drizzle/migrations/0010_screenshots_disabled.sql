ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "screenshots_disabled" boolean NOT NULL DEFAULT false;

-- Super-admin-only kill switch for periodic screen capture per user.
-- When true, the screenshot upload endpoint returns 403 and the extension
-- skips capturing entirely (saves bandwidth + battery).
-- Toggled via PUT /api/admin/users/:id/screenshots — gated by requireSuperAdmin.
