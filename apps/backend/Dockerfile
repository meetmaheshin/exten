# ─── Build stage ───
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./

# Copy packages and backend source
COPY packages/shared-types/ packages/shared-types/
COPY apps/backend/ apps/backend/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build shared-types first, then backend
RUN pnpm --filter @ailancers/shared-types run build
RUN pnpm --filter @ailancers/backend run build

# ─── Production stage ───
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy built packages
COPY --from=builder /app/packages/shared-types/package.json /app/packages/shared-types/
COPY --from=builder /app/packages/shared-types/dist/ /app/packages/shared-types/dist/
COPY --from=builder /app/apps/backend/package.json /app/apps/backend/
COPY --from=builder /app/apps/backend/dist/ /app/apps/backend/dist/
COPY --from=builder /app/apps/backend/drizzle/ /app/apps/backend/drizzle/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Create data directories
RUN mkdir -p /app/data/screenshots

WORKDIR /app/apps/backend

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
