# Ailancers — Developer Handover Guide

## What Is This?

A complete employee activity tracking system with 4 applications in one monorepo:

| App | Location | Purpose |
|-----|----------|---------|
| **Backend API** | `apps/backend/` | Fastify server — auth, telemetry, AI proxy, admin APIs |
| **Admin Dashboard** | `apps/dashboard/` | Next.js static site — monitor team activity, projects, AI costs |
| **VS Code Extension** | `apps/extension/` | Activity tracker + AI coding agent for developers |
| **Desktop Tracker** | `apps/desktop/` | Electron tray app for non-developers (HR, admins, designers) |
| **Shared Types** | `packages/shared-types/` | TypeScript types shared across all apps |

---

## Tech Stack

- **Runtime:** Node.js 22, TypeScript 5.9
- **Monorepo:** pnpm workspaces + Turborepo
- **Backend:** Fastify, Drizzle ORM, PostgreSQL, WebSocket
- **Dashboard:** Next.js 15 (static export, `output: "export"`)
- **Extension:** VS Code Extension API, esbuild
- **Desktop:** Electron 31, electron-builder
- **AI:** Anthropic Claude SDK (primary), OpenAI SDK (fallback)
- **Deployment:** Railway (single service — backend serves dashboard static files)

---

## Repository Structure

```
ailancers-code/
├── apps/
│   ├── backend/              # Fastify API server
│   │   ├── src/
│   │   │   ├── config/       # env.ts, database.ts
│   │   │   ├── middleware/    # requireAuth.ts
│   │   │   ├── models/       # Drizzle ORM schemas
│   │   │   ├── routes/       # API route handlers
│   │   │   ├── services/     # AIService, AuthService, ProjectSyncService, etc.
│   │   │   └── app.ts        # Fastify app setup + route registration
│   │   ├── drizzle/
│   │   │   └── migrations/   # SQL migrations (0000-0004)
│   │   └── Dockerfile
│   │
│   ├── dashboard/            # Next.js admin dashboard
│   │   ├── src/app/          # Pages: /, /projects, /users, /activity, /ai-usage, /screenshots, /employees, /downloads
│   │   ├── src/components/   # Sidebar, DashboardShell, StatCard, AuthProvider
│   │   └── src/lib/          # api.ts, auth.ts, format.ts
│   │
│   ├── extension/            # VS Code extension
│   │   ├── src/
│   │   │   ├── services/     # TelemetryService, ActivityTracker, ChatService, etc.
│   │   │   ├── providers/    # StatusBar, Sidebar, ActivityDashboard
│   │   │   └── extension.ts  # Entry point
│   │   └── webview/          # React chat UI (Vite build)
│   │
│   └── desktop/              # Electron desktop tracker
│       ├── src/
│       │   ├── main/         # Main process: tray, services, IPC
│       │   ├── renderer/     # HTML windows (login, picker)
│       │   └── preload/      # Context bridge
│       ├── scripts/          # build.js, launch.js
│       └── electron-builder.yml
│
├── packages/
│   └── shared-types/         # Shared TypeScript types
│       └── src/              # telemetry.ts, api.ts, agent.ts, user.ts
│
├── package.json              # Root workspace config
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

---

## Local Development Setup

### Prerequisites

- Node.js 22+
- pnpm 10+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- PostgreSQL 15+ (local or Docker)
- Git

### 1. Clone the repo

```bash
git clone https://gitlab.com/rovidevs/ailancers-vscode-ext.git
cd ailancers-vscode-ext
git checkout dev-mahesh
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Set up PostgreSQL

Create a local database:

```bash
createdb ailancers_dev
```

Or with Docker:

```bash
docker run -d --name ailancers-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ailancers_dev postgres:15
```

### 4. Create `.env` file

Copy this to `apps/backend/.env`:

```env
PORT=8080
HOST=0.0.0.0
NODE_ENV=development

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ailancers_dev

JWT_SECRET=your-secret-key-at-least-32-characters-long
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=30d

ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
ANTHROPIC_DEFAULT_MODEL=claude-sonnet-4-6
ANTHROPIC_MAX_TOKENS=16384

# Optional — leave empty to disable OpenAI
OPENAI_API_KEY=
OPENAI_DEFAULT_MODEL=gpt-4o
OPENAI_CODING_MODEL=gpt-4.1

AGENT_MAX_TOKENS=16384
AGENT_MAX_TURNS=50

CORS_ORIGINS=http://localhost:3001

SCREENSHOT_MAX_SIZE_MB=5

# Optional — AI billing reporter
AILANCERS_BILLING_API_URL=
AILANCERS_BILLING_HMAC_SECRET=
```

### 5. Run database migrations

Migrations run automatically when the backend starts. Or run manually:

```bash
cd apps/backend
pnpm run build
node -e "import('./dist/config/database.js').then(m => m.runMigrations())"
```

### 6. Build shared types

```bash
pnpm --filter @ailancers/shared-types run build
```

### 7. Start the backend

```bash
cd apps/backend
pnpm run dev
```

Server starts at `http://localhost:8080`. The first startup creates all tables via migrations.

### 8. Create an admin user

There's no signup UI. Insert directly:

```sql
INSERT INTO users (id, email, password_hash, full_name, role, is_active)
VALUES (
  gen_random_uuid(),
  'admin@yourcompany.com',
  -- This is bcrypt hash for 'password123'
  '$2b$10$rOzPqHx7C4VjJHh6VnXKxeYo3GdBqXKmF9xGGzKzHQl5kZQJKmG6y',
  'Admin User',
  'admin',
  true
);
```

Or use the existing platform auth flow (logs in via `staging-backend.ailancers.com`).

### 9. Start the dashboard (optional, for local dev)

```bash
cd apps/dashboard
pnpm run dev
```

Dashboard at `http://localhost:3000/dashboard/`. In production, the dashboard is served as static files from the backend.

---

## Building Each App

### Backend

```bash
cd apps/backend
pnpm run build    # TypeScript → dist/
```

### Dashboard

```bash
cd apps/dashboard
pnpm run build    # Next.js static export → out/
```

### VS Code Extension

```bash
pnpm --filter @ailancers/shared-types run build
cd apps/extension
pnpm run build    # esbuild + vite → dist/
pnpm run package  # → ailancers-code-0.2.0.vsix
```

Install: VS Code → Ctrl+Shift+P → "Install from VSIX"

### Desktop Tracker

```bash
cd apps/desktop
pnpm run build                    # TypeScript → dist/

# Package for Windows (run in admin PowerShell):
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npx electron-builder --win --dir  # → out/win-unpacked/Ailancers Tracker.exe
```

---

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `users` | All registered users (email, password hash, role, team) |
| `refresh_tokens` | JWT refresh token rotation (hashed, 30-day expiry) |
| `projects` | Internal projects (workspace-level) |
| `conversations` | Chat/agent conversations |
| `messages` | Chat messages with token counts and cost |
| `ai_usage_daily` | Per-user per-day AI token/cost aggregation |
| `budget_alerts` | Monthly budget threshold alerts |

### Tracking Tables

| Table | Purpose |
|-------|---------|
| `activity_sessions` | One row per tracking session (login→logout). Accumulates active_seconds, idle_seconds, keystrokes, file_saves. Has `external_project_id` and `external_task_id` for project attribution. |
| `telemetry_events` | Raw heartbeat events (JSON payload per flush) |
| `screenshots` | Screenshot metadata + image stored as `bytea` in PostgreSQL |

### External Platform Tables

| Table | Purpose |
|-------|---------|
| `external_projects` | Cached from habitnetwork API (120 projects) |
| `external_tasks` | Cached tasks (831 tasks), JSONB `assigned_users` with GIN index |
| `external_user_mappings` | Maps our `user_id` → platform `external_user_id` (match_type: exact/confirmed/manual) |
| `employee_directory` | Imported from HR CSV — name, email, department, manager, external_user_id |

### Migrations

Located in `apps/backend/drizzle/migrations/`:

| File | What it does |
|------|-------------|
| `0000_initial.sql` | All core tables (users, sessions, messages, etc.) |
| `0001_add_screenshot_image_data.sql` | Adds `image_data bytea` to screenshots |
| `0002_external_projects.sql` | External projects, tasks, user mappings, GIN indexes, pg_trgm |
| `0003_app_usage_tracking.sql` | App usage columns |
| `0004_employee_directory.sql` | Employee directory table |

Migrations run automatically on backend startup via Drizzle's `migrate()`.

---

## API Endpoints

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | None | Email/password → accessToken + refreshToken |
| POST | `/api/auth/refresh` | None | refreshToken → new tokens |
| POST | `/api/auth/logout` | Bearer | Revokes refresh token |
| GET | `/api/auth/me` | Bearer | Current user profile |

### Telemetry

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/telemetry/session/start` | Bearer | Start tracking session |
| POST | `/api/telemetry/session/heartbeat` | Bearer | Send activity metrics (every 60s) |
| POST | `/api/telemetry/session/end` | Bearer | End tracking session |
| POST | `/api/telemetry/screenshot` | Bearer | Upload screenshot (base64 PNG) |
| GET | `/api/telemetry/screenshots/:id/image` | Bearer or `?token=` | Serve screenshot image |

### Projects (Developer)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/projects/mine` | Bearer | User's assigned projects + tasks |
| POST | `/api/projects/confirm-identity` | Bearer | Confirm platform identity (duplicate name resolution) |
| GET | `/api/projects/:id/tasks` | Bearer | Tasks for a specific project |
| GET | `/api/activity/me/summary` | Bearer | User's own activity summary |
| GET | `/api/activity/me/sessions` | Bearer | User's own sessions |

### Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/sync/projects` | Admin | Sync projects from habitnetwork API |
| GET | `/api/admin/sync/status` | Admin | Sync status (counts, last sync time) |
| GET | `/api/admin/projects/list` | Admin | All projects with activity stats |
| GET | `/api/admin/projects/:id/detail` | Admin | Project detail (users, tasks, daily) |
| GET | `/api/admin/projects/live` | Admin | Currently active sessions |
| GET | `/api/admin/activity/overview` | Admin | Team overview (all users aggregated) |
| GET | `/api/admin/activity/daily` | Admin | Daily activity aggregation |
| GET | `/api/admin/activity/date/:date` | Admin | All users breakdown for a specific date |
| GET | `/api/admin/activity/user/:id` | Admin | User detail (summary + AI usage) |
| GET | `/api/admin/activity/user/:id/sessions` | Admin | User sessions with project/task names |
| GET | `/api/admin/ai-usage/daily` | Admin | Daily AI usage aggregation |
| GET | `/api/admin/ai-usage/user/:id/daily` | Admin | Per-user daily AI breakdown |
| GET | `/api/admin/users` | Admin | List all users |
| GET | `/api/admin/employees` | Admin | List employee directory |
| POST | `/api/admin/employees/import-csv` | Admin | Import employees from CSV |
| GET | `/api/admin/screenshots` | Admin | List screenshots (filterable) |
| GET | `/api/admin/user-mappings` | Admin | List user ↔ platform mappings |
| PUT | `/api/admin/user-mappings/:userId` | Admin | Manually set user mapping |

### Chat (WebSocket)

| Path | Description |
|------|-------------|
| `ws://host/api/chat/stream?token=JWT` | Real-time chat + agent mode. Supports message types: `message`, `agent_message`, `cancel`, `tool_result` |

---

## How Authentication Works

Two auth flows coexist:

### 1. Local Auth (backend JWT)
- `POST /api/auth/login` with email/password
- Returns `accessToken` (15m) + `refreshToken` (30 days)
- Refresh tokens are SHA-256 hashed in DB, rotated on use

### 2. Platform Auth (Ailancers staging)
- Extension/desktop login via `https://staging-backend.ailancers.com/api/v1/auth/login`
- Returns a platform token
- Backend verifies platform tokens via `GET /api/v1/auth/verify` (cached)
- Dashboard uses local auth; extension/desktop use platform auth

The `requireAuth` middleware accepts both: checks local JWT first, falls back to platform token verification.

---

## How Activity Tracking Works

```
User opens VS Code / Desktop Tracker
        ↓
Extension/Desktop authenticates → POST /api/telemetry/session/start → session_id
        ↓
Every 60 seconds:
  ActivityTracker.harvestMetrics() → { activeSeconds, idleSeconds, keystrokes, ... }
  POST /api/telemetry/session/heartbeat → updates activity_sessions row
        ↓
Every 5 minutes (if not idle):
  ScreenCapture → full screen PNG → POST /api/telemetry/screenshot (base64 in DB)
        ↓
Idle detection:
  OS idle > 10 minutes → pause heartbeats + screenshots
  Activity resumes → resume tracking
        ↓
User closes VS Code / quits desktop app → POST /api/telemetry/session/end
```

---

## How Project/Task Attribution Works

1. Backend syncs projects from `https://mailerai.habitnetwork.xyz/api/project-info` (120 projects, 831 tasks)
2. Employee CSV import maps emails → platform user IDs
3. When user calls `GET /api/projects/mine`:
   - Looks up `external_user_mappings` for their platform ID
   - If not mapped: tries email match via `employee_directory`
   - Queries `external_tasks` with JSONB containment (`assigned_users @> [{"id": N}]`)
   - Returns their projects + tasks
4. User picks project/task in extension/desktop
5. Every heartbeat includes `externalProjectId` + `externalTaskId`
6. Dashboard shows time attributed per project/task

---

## Railway Deployment

Single Railway service runs the backend, which also serves the dashboard static files.

### How it works

1. `Dockerfile` (at `apps/backend/Dockerfile`) builds everything:
   - Builds shared-types, backend, and dashboard
   - Copies dashboard `out/` into `dist/dashboard-dist/`
   - Backend manually serves `/dashboard/*` routes from this folder
2. Railway auto-deploys on push to GitHub `main`

### Environment Variables (Railway)

Set these in Railway's Variables tab:

```
DATABASE_URL=postgresql://...         (Railway provides this automatically)
JWT_SECRET=<random 64-char string>
ANTHROPIC_API_KEY=sk-ant-api03-...
NODE_ENV=production
PORT=8080
```

### Running Migrations on Production

Migrations run automatically on startup. For manual SQL, use Railway's Database → Query tab.

---

## External Integrations

### Habitnetwork API (Project Sync)

- URL: `https://mailerai.habitnetwork.xyz/api/project-info`
- Returns all projects with tasks and assigned users
- Synced via `POST /api/admin/sync/projects` (admin dashboard "Sync Now" button)
- `ProjectSyncService` upserts in batches of 50 projects / 100 tasks

### Ailancers Staging (Platform Auth)

- URL: `https://staging-backend.ailancers.com`
- Login: `POST /api/v1/auth/login`
- Verify: `GET /api/v1/auth/verify`
- Extension and desktop app authenticate through this

### AI Billing Reporter

- Optional integration (Gaurav's addition)
- Reports token usage to `AILANCERS_BILLING_API_URL` via HMAC-signed requests
- Runs on a configurable interval (default 3 minutes)

---

## Common Tasks

### Add a new user

Insert into DB or have them login via platform auth (auto-creates user on first login).

### Import employees from CSV

Dashboard → Employees → Import CSV. CSV format:
```
"Active","Activities","Company","Department","Employee Name","Job Position","Manager","Next Activity Deadline","Work Address","Work Email","Work Phone","User/ID"
```

### Sync projects from platform

Dashboard → Projects → "Sync Now" button, or:
```bash
curl -X POST https://your-app.railway.app/api/admin/sync/projects -H "Authorization: Bearer <admin-token>"
```

### Build and distribute the VS Code extension

```bash
pnpm --filter @ailancers/shared-types run build
cd apps/extension
pnpm run build
npx @vscode/vsce package --no-dependencies
# → ailancers-code-0.2.0.vsix
```

### Build the desktop tracker (.exe)

```powershell
cd apps/desktop
pnpm run build
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npx electron-builder --win --dir
# → out/win-unpacked/Ailancers Tracker.exe
```

---

## Known Issues / Gotchas

1. **Electron + pnpm:** pnpm symlinks the `electron` npm package into `node_modules/electron`, which shadows Electron's internal module. The `scripts/launch.js` handles this for dev mode. `electron-builder` packages correctly for production.

2. **JSONB containment queries:** Drizzle's `sql` tagged templates double-escape string parameters. Use `sql.raw()` for JSONB `@>` containment literals.

3. **Screenshots in DB:** Stored as `bytea` in PostgreSQL (not filesystem). Survives Railway redeploys but uses DB storage. Consider S3 for scale.

4. **Dashboard static export:** Next.js `output: "export"` means no SSR. All data fetching happens client-side. The backend serves these static files from `dist/dashboard-dist/`.

5. **Desktop keystroke tracking:** Desktop tracker reports 0 keystrokes — this is expected for non-dev users. Would need `uiohook-napi` native addon for OS-level keyboard counting.

6. **Token auth for images:** `<img>` tags can't send Bearer headers. Screenshot image endpoint supports `?token=JWT` query param as fallback.

---

## Contacts

- **Repo (GitHub):** https://github.com/meetmaheshin/exten
- **Repo (GitLab):** https://gitlab.com/rovidevs/ailancers-vscode-ext (branch: `dev-mahesh`)
- **Production:** https://exten-production.up.railway.app
- **Dashboard:** https://exten-production.up.railway.app/dashboard/
- **Downloads page:** https://exten-production.up.railway.app/dashboard/downloads/
