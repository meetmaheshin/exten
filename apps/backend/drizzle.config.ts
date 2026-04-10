import { defineConfig } from "drizzle-kit";

// IMPORTANT: drizzle-kit loads schema files via Node's CJS resolver and
// cannot translate the `./users.js` ESM import suffix back to `./users.ts`.
// Instead we point it at the compiled `dist/models/*.js` output, where the
// `.js` extensions are real on-disk files that Node can load directly.
// Run `pnpm run build` (or at least `pnpm exec tsc -p tsconfig.json`) before
// `pnpm run db:generate` so the models in `dist/` are up to date.
export default defineConfig({
  schema: "./dist/models/*.js",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
