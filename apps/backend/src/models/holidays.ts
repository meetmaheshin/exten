import { pgTable, uuid, varchar, date, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Company-wide non-working days. Used by Team Snapshot to (a) exclude these
 * from working-day counts in ATD/TB% math and (b) render cells as "Holiday"
 * (light blue) instead of "no data" red.
 *
 * Scope is intentionally global — we don't model per-region holidays yet.
 * If/when we need that, add an optional `region` column.
 */
export const holidays = pgTable(
  "holidays",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    date: date("date").notNull().unique(),
    name: varchar("name", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_holidays_date").on(table.date)]
);
