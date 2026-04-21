# Manual Deployment Guide (Without Docker)

Deploying ailancers-vscode-ext backend + dashboard on a VPS using systemd + nginx.

Server: Ubuntu with PostgreSQL, Redis, Node.js, nginx already available.

---

## Fresh Setup

### 1. Clone & Checkout

```bash
git clone https://gitlab.com/rovidevs/ailancers-vscode-ext
cd ailancers-vscode-ext
git checkout dev-mahesh
git pull
```

### 2. Node & pnpm

```bash
nvm install 22
nvm use 22
npm install -g pnpm@latest
```

### 3. Install Dependencies & Build

```bash
# From repo root
pnpm install --frozen-lockfile
pnpm --filter @ailancers/shared-types run build
pnpm --filter @ailancers/backend run build
```

### 4. Configure Environment

```bash
cd apps/backend
vi .env
# Set DATABASE_URL, REDIS_URL, JWT_SECRET, ANTHROPIC_API_KEY, etc.
```

### 5. Database Setup

```bash
# Create database
PGPASSWORD=admin psql -h 127.0.0.1 -U root -d postgres -c "CREATE DATABASE ailance_vscode_ext;"

# Run migrations
pnpm run db:migrate

# If db:migrate fails, apply migrations manually:
PGPASSWORD=admin psql -h 127.0.0.1 -U root -d ailance_vscode_ext -f drizzle/migrations/0001_add_screenshot_image_data.sql
PGPASSWORD=admin psql -h 127.0.0.1 -U root -d ailance_vscode_ext -f drizzle/migrations/0002_external_projects.sql
PGPASSWORD=admin psql -h 127.0.0.1 -U root -d ailance_vscode_ext -f drizzle/migrations/0003_app_usage_tracking.sql
PGPASSWORD=admin psql -h 127.0.0.1 -U root -d ailance_vscode_ext -f drizzle/migrations/0004_employee_directory.sql

# Seed initial data
pnpm run db:seed
```

### 6. Build Dashboard & Copy to Backend

```bash
cd ../../  # back to repo root
pnpm --filter @ailancers/shared-types run build
pnpm --filter @ailancers/dashboard run build
rm -rf apps/backend/dist/dashboard-dist
cp -r apps/dashboard/out/ apps/backend/dist/dashboard-dist
```

### 7. Systemd Service

```bash
sudo vi /etc/systemd/system/ailancers-vscode-ext-backend.service
```

```ini
[Unit]
Description=Ailancers VSCode Extension Backend
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/ailancers-vscode-ext/apps/backend
ExecStart=/root/.nvm/versions/node/v22.*/bin/node dist/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/root/ailancers-vscode-ext/apps/backend/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable ailancers-vscode-ext-backend
sudo systemctl start ailancers-vscode-ext-backend
```

### 8. Nginx + SSL

```bash
sudo vi /etc/nginx/sites-available/default
```

Add a server block for `apivscode.ailancers.com` proxying to `localhost:5000`.

```bash
sudo service nginx restart
sudo certbot -d apivscode.ailancers.com
```

### 9. Verify

```bash
curl http://localhost:5000/health
systemctl status ailancers-vscode-ext-backend
journalctl -u ailancers-vscode-ext-backend -f
```

---

## Redeployment (Code Update)

```bash
cd ~/ailancers-vscode-ext
git pull
nvm use 22
pnpm install --frozen-lockfile
pnpm --filter @ailancers/shared-types run build
pnpm --filter @ailancers/backend run build
pnpm --filter @ailancers/dashboard run build
cp -r apps/dashboard/out/ apps/backend/dist/dashboard-dist
cd apps/backend && pnpm run db:migrate && cd ../..
sudo systemctl restart ailancers-vscode-ext-backend
```

---

## Useful Commands

| Command | Purpose |
|---------|---------|
| `systemctl status ailancers-vscode-ext-backend` | Check service status |
| `systemctl restart ailancers-vscode-ext-backend` | Restart after deploy |
| `journalctl -u ailancers-vscode-ext-backend -f` | Tail logs |
| `curl http://localhost:5000/health` | Health check |

---

## Troubleshooting

**Service won't start:**
- Check `journalctl -u ailancers-vscode-ext-backend -f` for errors
- Ensure `nvm use 22` was run and `ExecStart` path points to correct node binary
- Verify `.env` has all required values

**Database migration fails:**
- Drop and recreate: `PGPASSWORD=admin psql -h 127.0.0.1 -U root -d postgres -c "DROP DATABASE IF EXISTS ailance_vscode_ext;"` then recreate
- Apply migrations manually (see step 5)
- Check `drizzle/migrations/meta/_journal.json` if migration state is corrupted

**502 Bad Gateway from nginx:**
- Backend not running: `systemctl start ailancers-vscode-ext-backend`
- Wrong port in nginx config — backend runs on port 5000
