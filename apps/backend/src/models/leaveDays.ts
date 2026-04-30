import { pgTable, uuid, varchar, date, timestamp, index, unique } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Per-user days off. Used to subtract a user's leaves from their working-day
 * count in ATD math, and to render the snapshot cell as "Leave" / "Sick"
 * / "1/2 Day" instead of red "no data".
 *
 * leaveType is a free-form string with a small expected vocabulary —
 * 'full' | 'half' | 'sick' | 'paid' | 'unpaid'. We don't enforce it as a
 * Postgres enum so admins can introduce new types without a migration.
 *
 * Half-day = 4h. The grid still renders the cell as "Leave" with a
 * tooltip; the working-day count subtracts 0.5 instead of 1.
 */
export const leaveDays = pgTable(
  "leave_days",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    leaveType: varchar("leave_type", { length: 20 }).notNull().default("full"),
    note: varchar("note", { length: 500 }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_leave_days_user").on(table.userId),
    index("idx_leave_days_date").on(table.date),
    unique("leave_days_user_date_unique").on(table.userId, table.date),
  ]
);
