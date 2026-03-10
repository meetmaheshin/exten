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

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

ENV NODE_ENV=production

# Copy workspace config for pnpm
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy shared-types (needed at runtime)
COPY --from=builder /app/packages/shared-types/package.json /app/packages/shared-types/
COPY --from=builder /app/packages/shared-types/dist/ /app/packages/shared-types/dist/

# Copy dashboard app
COPY --from=builder /app/apps/dashboard/package.json /app/apps/dashboard/
COPY --from=builder /app/apps/dashboard/.next/ /app/apps/dashboard/.next/
COPY --from=builder /app/apps/dashboard/public/ /app/apps/dashboard/public/
COPY --from=builder /app/apps/dashboard/next.config.ts /app/apps/dashboard/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

WORKDIR /app/apps/dashboard

EXPOSE 3001

ENV PORT=3001
ENV HOSTNAME=0.0.0.0

CMD ["pnpm", "start"]
