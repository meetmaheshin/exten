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

---

## Releasing a new version of the VS Code extension or desktop tracker

Binary distribution lives on GitHub Releases at <https://github.com/dmahaesh/ailancers-code/releases>. The dashboard download buttons point at `releases/latest/download/<filename>`, which always serves the most recent release — so once a release is published, the website "just updates" without any code changes.

### Prerequisites (one-time setup)

```bash
# Authenticate the gh CLI on whatever machine runs the release
gh auth login
# Pick GitHub.com → HTTPS → Login with web browser
```

You also need write access to the `dmahaesh/ailancers-code` repo on GitHub.

### Cutting a release

```bash
# Optional: build the desktop installer first if it's part of this release
pnpm --filter "@ailancers/desktop" package:win     # Windows .exe
pnpm --filter "@ailancers/desktop" package:linux   # .deb + .tar.gz

# Then run the release script with the new version number
./scripts/release.sh 0.2.4
```

The script:

1. Bumps version in `apps/extension/package.json`, `CURRENT_VERSION` in `extension.ts`, and the `/api/version` response in `backend/src/app.ts`
2. Builds the .vsix
3. Renames artifacts to stable filenames (`ailancers-code.vsix`, `Ailancers-Tracker-Setup.exe`, etc.)
4. Tags and pushes
5. Creates a GitHub Release with all artifacts attached

**After the script finishes**, redeploy the backend so `/api/version` reports the new version (otherwise existing users won't see the "Update available" toast):

```bash
# On the VPS
cd /root/ailancers-vscode-ext
git pull
pnpm --filter @ailancers/shared-types build
pnpm --filter @ailancers/backend build
sudo systemctl restart ailancers-backend
```

That's the whole flow. The downloads page on the dashboard automatically shows the new version (it reads `/api/version` live) and the download buttons keep working.

---

## Linux desktop artifacts — built by GitLab CI

`electron-builder` on Windows can't produce `.deb` / `.tar.gz` (those need a Linux build host). `.gitlab-ci.yml` fills that gap: every time `scripts/release.sh` pushes a `v*.*.*` tag to GitLab, a Linux runner builds the Linux artifacts and uploads them to the GitHub release that the script just created.

### One-time setup

1. **Generate a GitHub PAT** (fine-grained, dmahaesh account):
   - URL: https://github.com/settings/personal-access-tokens/new
   - Resource owner: `dmahaesh`
   - Repository access: "Only select repositories" → `ailancers-code`
   - Permissions → Repository permissions → **Contents: Read and write**
   - Expiration: 1 year (or whatever your policy is)
   - Generate → copy the `github_pat_…` token immediately

2. **Add it to GitLab as a CI variable**:
   - URL: https://gitlab.com/rovidevs/ailancers-vscode-ext/-/settings/ci_cd
   - Expand "Variables" → "Add variable"
   - Key: `GH_RELEASE_TOKEN`
   - Value: paste the PAT
   - Flags: Masked, Protect variable (Protected)
   - Save

3. **Protect the `v*` tag pattern on GitLab**:
   - URL: https://gitlab.com/rovidevs/ailancers-vscode-ext/-/settings/repository
   - Expand "Protected tags" → Tag: `v*` → Allowed to create: Maintainers
   - This scopes `GH_RELEASE_TOKEN` to release tags only.

After this, no per-release action is needed. The flow becomes:

```
bash scripts/release.sh 0.2.18
   │
   ├─→ builds .vsix + Windows .exe locally
   ├─→ creates GitHub release on dmahaesh/ailancers-code with those two files
   └─→ pushes tag v0.2.18 to GitLab
            │
            └─→ .gitlab-ci.yml fires
                  │
                  ├─→ build-linux job (~3 min): produces .deb / .tar.gz
                  └─→ upload-github job: gh release upload --clobber

→ ~5 minutes after the script finishes, all four download URLs work.
```

### Troubleshooting

- **CI didn't fire after release.sh**: did the tag push to GitLab succeed? Check `git ls-remote gitlab refs/tags/v0.2.18`. The release script keeps going even if the GitLab push fails, so re-run `git push gitlab vX.Y.Z` manually.
- **`GH_RELEASE_TOKEN missing` in upload-github**: the variable isn't scoped to the tag. Confirm "Protect variable" is checked AND the `v*` tag pattern is protected.
- **`gh release upload` fails with 404**: the release on `dmahaesh/ailancers-code` doesn't exist yet. `release.sh` should have created it before pushing the tag — if it didn't, run `gh release create vX.Y.Z --repo dmahaesh/ailancers-code` manually, then re-run the CI job.
