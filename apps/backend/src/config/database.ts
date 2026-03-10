import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Env } from "./env.js";
import * as schema from "../models/index.js";

export function createDb(env: Env) {
  const client = postgres(env.DATABASE_URL, { max: 20 });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
