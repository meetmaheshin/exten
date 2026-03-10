# Ailancers Code - Deployment Guide

## Architecture Overview

```
Developers' VS Code ──→ Backend Server ──→ Anthropic Claude API
  (extension .vsix)     (your server)      (your API key)
                             │
                        PostgreSQL + Redis
                             │
Admin Browser ──→ Dashboard (Next.js)
```

**You deploy the backend + dashboard on your server. Developers only install the VS Code extension.**

---

## Where to Deploy

Choose ONE of these options:

| Option | Cost | Best For |
|--------|------|----------|
| **VPS (DigitalOcean, Hetzner, Linode)** | $20-50/mo | Small teams, full control |
| **AWS EC2 / GCP Compute** | $30-100/mo | Enterprise teams |
| **Railway / Render** | $25-50/mo | Easiest setup, managed |
| **Your own server** | Existing infra | On-premise requirement |

**Minimum Requirements:** 2 vCPU, 4GB RAM, 40GB SSD (for 100 developers)

---

## Step-by-Step Deployment

### 1. Get an Anthropic API Key

1. Go to https://console.anthropic.com/settings/keys
2. Create a new API key
3. Add credits to your account (this is what your team uses for AI coding)

**Cost estimate for 100 developers:**
- Light usage (~20 requests/dev/day): ~$500-1000/month
- Heavy usage (~100 requests/dev/day): ~$3000-5000/month
- The backend tracks every token so you can monitor costs in real-time

### 2. Set Up Your Server

```bash
# SSH into your server
ssh user@your-server-ip

# Install Docker & Docker Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Clone the project
git clone <your-repo-url> ailancers-code
cd ailancers-code
```

### 3. Configure Environment

```bash
# Copy and edit the environment file
cp .env.example .env
nano .env
```

**Critical values to set:**

```env
# Strong passwords (generate random ones)
POSTGRES_PASSWORD=<run: openssl rand -hex 16>
REDIS_PASSWORD=<run: openssl rand -hex 16>
JWT_SECRET=<run: openssl rand -hex 32>

# Your Anthropic API key
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx

# Update DATABASE_URL with matching password
DATABASE_URL=postgresql://ailancers:<your-postgres-password>@postgres:5432/ailancers
REDIS_URL=redis://:<your-redis-password>@redis:6379

# Your domain (or server IP:port for testing)
CORS_ORIGINS=https://admin.yourdomain.com
PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

### 4. Deploy

```bash
# Build and start all services
docker compose -f docker-compose.prod.yml up -d --build

# Wait for services to be healthy
docker compose -f docker-compose.prod.yml ps

# Run database setup (first time only)
docker compose -f docker-compose.prod.yml exec backend \
  node -e "require('dotenv/config')" && \
  cd apps/backend && pnpm run db:generate && pnpm run db:migrate && pnpm run db:seed
```

**Or if running locally for initial setup:**
```bash
# Start just the database
docker compose up -d postgres redis

# Run migrations locally
cd apps/backend
pnpm run db:generate
pnpm run db:migrate
pnpm run db:seed
```

### 5. Verify

- Backend health: `curl http://your-server:3000/health`
- Dashboard: Open `http://your-server:3001` in browser
- Login with: `admin@ailancers.com` / `password123`
- **Change the admin password immediately!**

### 6. Set Up DNS (Optional but Recommended)

Point two subdomains to your server:
- `api.yourdomain.com` → your server IP (port 3000)
- `admin.yourdomain.com` → your server IP (port 3001)

For HTTPS, use the included nginx config:
```bash
docker compose -f docker-compose.prod.yml --profile with-nginx up -d
```

---

## Distribute to Your Team

### Build the Extension

```bash
cd apps/extension
pnpm run build
npx @vscode/vsce package --no-dependencies
# Creates: ailancers-code-0.1.0.vsix
```

### Install Instructions for Developers

Send this to your team:

---

**Setting up Ailancers Code:**

1. Download `ailancers-code-0.1.0.vsix`
2. Open VS Code
3. Press `Ctrl+Shift+P` → type "VSIX" → select **"Install from VSIX..."**
4. Select the downloaded file
5. Reload VS Code when prompted
6. Open Settings (`Ctrl+,`) → search "ailancers" → set **Server URL** to:
   ```
   https://api.yourdomain.com
   ```
7. Click the Ailancers icon in the sidebar → Sign In with your credentials

---

## Managing Your Team

### Create Developer Accounts

Login to the admin dashboard and use the API to create users:

```bash
# Create a new developer account
curl -X POST https://api.yourdomain.com/api/auth/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "email": "developer@company.com",
    "password": "initial-password",
    "fullName": "John Doe",
    "role": "developer",
    "team": "Backend Team"
  }'
```

Or add users via the seed script by editing `apps/backend/src/db/seed.ts`.

### Monitor Usage

- **Dashboard** → Team Overview: See all developers' activity
- **Dashboard** → AI Usage & Cost: Track spending per developer
- **Dashboard** → Screenshots: View work verification captures
- **Dashboard** → Activity: Daily team-wide metrics

### Update the Extension

When you release a new version:
1. Bump version in `apps/extension/package.json`
2. `pnpm run build && npx @vscode/vsce package --no-dependencies`
3. Distribute the new `.vsix` to your team

---

## Quick Deploy with Railway (Easiest)

If you don't want to manage servers:

1. Push code to GitHub
2. Go to https://railway.app
3. Create new project → Deploy from GitHub
4. Add services: PostgreSQL, Redis
5. Deploy the backend (set root directory to `apps/backend`)
6. Deploy the dashboard (set root directory to `apps/dashboard`)
7. Set environment variables in Railway dashboard
8. Railway gives you URLs automatically — no DNS needed

---

## Troubleshooting

**Extension can't connect to server:**
- Check the Server URL setting in VS Code
- Ensure CORS_ORIGINS includes the extension's origin
- Test: `curl https://api.yourdomain.com/health`

**Dashboard login fails:**
- Check NEXT_PUBLIC_API_URL is set correctly
- Ensure the backend is running: `docker compose logs backend`

**AI chat not working:**
- Verify ANTHROPIC_API_KEY is correct
- Check backend logs: `docker compose logs -f backend`
- Ensure you have credits in your Anthropic account

**Database issues:**
- Check connection: `docker compose exec postgres psql -U ailancers -c "SELECT 1"`
- View logs: `docker compose logs postgres`
