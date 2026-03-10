#!/bin/bash
# ═══════════════════════════════════════════
# Ailancers Code - Database Setup Script
# Run this ONCE after first deployment
# ═══════════════════════════════════════════

set -e

echo "═══ Ailancers Code - Database Setup ═══"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
  echo "ERROR: .env file not found!"
  echo "Copy .env.example to .env and fill in your values first."
  exit 1
fi

# Load env vars
export $(grep -v '^#' .env | xargs)

echo "1. Generating database migrations..."
cd apps/backend
pnpm run db:generate

echo ""
echo "2. Running migrations..."
pnpm run db:migrate

echo ""
echo "3. Seeding initial data (admin user + sample projects)..."
pnpm run db:seed

echo ""
echo "═══ Database setup complete! ═══"
echo ""
echo "Default admin login:"
echo "  Email:    admin@ailancers.com"
echo "  Password: password123"
echo ""
echo "IMPORTANT: Change the admin password immediately after first login!"
