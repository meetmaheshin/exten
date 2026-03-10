import { pgTable, uuid, date, integer, decimal, jsonb, unique, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { projects } from "./projects.js";

export const aiUsageDaily = pgTable(
  "ai_usage_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    totalRequests: integer("total_requests").notNull().default(0),
    totalInputTokens: integer("total_input_tokens").notNull().default(0),
    totalOutputTokens: integer("total_output_tokens").notNull().default(0),
    totalCostUsd: decimal("total_cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
    modelBreakdown: jsonb("model_breakdown").default({}),
  },
  (table) => [
    unique("uq_ai_usage_user_project_date").on(table.userId, table.projectId, table.date),
    index("idx_ai_usage_user_date").on(table.userId, table.date),
    index("idx_ai_usage_project_date").on(table.projectId, table.date),
  ]
);
