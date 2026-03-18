# ─── Build stage ───
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./

# Copy packages and dashboard source
COPY packages/shared-types/ packages/shared-types/
COPY apps/dashboard/ apps/dashboard/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build
RUN pnpm --filter @ailancers/shared-types run build
RUN pnpm --filter @ailancers/dashboard run build

# ─── Production stage ───
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy only what Next.js standalone needs
COPY --from=builder /app/apps/dashboard/.next/standalone ./
COPY --from=builder /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder /app/apps/dashboard/public ./apps/dashboard/public

WORKDIR /app/apps/dashboard

EXPOSE 3001

ENV PORT=3001
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
