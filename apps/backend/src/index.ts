import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadEnv } from "./config/env.js";
import { createDb } from "./config/database.js";
import { buildApp } from "./app.js";

async function runMigrations(databaseUrl: string) {
  console.log("Running database migrations...");
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./drizzle/migrations" });
  await client.end();
  console.log("Migrations complete.");
}

async function main() {
  const env = loadEnv();

  // Auto-run migrations on startup
  try {
    await runMigrations(env.DATABASE_URL);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }

  const db = createDb(env);
  const app = await buildApp(env, db);

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Server running at http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    app.log.info("Shutting down gracefully...");
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
