import { pgTable, uuid, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { activitySessions } from "./activitySessions.js";
import { projects } from "./projects.js";

export const telemetryEvents = pgTable(
  "telemetry_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => activitySessions.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    eventData: jsonb("event_data").notNull().default({}),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_telemetry_user").on(table.userId),
    index("idx_telemetry_type").on(table.eventType),
    index("idx_telemetry_timestamp").on(table.timestamp),
  ]
);
