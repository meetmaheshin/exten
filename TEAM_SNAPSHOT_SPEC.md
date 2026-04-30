# Team Snapshot — Pivoted Timesheet View

A reference doc for the **Team Snapshot** dashboard page (planned). Rows = employees grouped under their manager, columns = days, cells = hours worked color-coded by threshold. Inspired by the equivalent view in the [cattr_dashbord](D:\cattr_dashbord) project.

This document captures the design decisions we're making **before** implementation, so future-us can come back, see what we shipped vs deferred, and pick up the next iteration without re-deciding everything.

---

## 1. Goal

Give admins and managers a **single grid view** of "who worked when, for how long" across the team. The current dashboard answers per-user questions ("how much did Shivam work last week?") but not per-day-cross-team questions ("who was on Wednesday?", "is Anshul's team underutilized?").

The pivot grid solves that in one screen.

---

## 2. Visual reference

User-supplied screenshot (cattr dashboard, anonymized):

```
| Manager / Employee  | ATD  | 4/26 | 4/25 | 4/24 | 4/23 | 4/22 | ... |
|---------------------|------|------|------|------|------|------|-----|
| 👤 Anshul Verma (2) | 4:51 | 0:00 | 0:00 | 5:06 | 3:56 | 4:19 |     |   ← group_header  TB: 90.9%
| Anshul Verma (Mgr)  | 0:00 | Sun  | Sat  | NoLog| NoLog| NoLog|     |   ← manager_self
| Mahesh Kumar [MAN]  | 7:53 | Sun  | Sat  | 8:49 | 8:00 | 8:18 |     |   ← employee
| Pankaj Mishra       | 6:40 | Sun  | Sat  | 6:30 | 3:50 | 4:40 |     |   ← employee
```

Key visual signals:
- **Manager header row** is purple, has the count `(2)` (number of direct reports) and the `TB:` percentage badge
- **MANUAL** orange badge on a row = all of that person's sessions were entered by an admin, not auto-tracked
- Cell colors: green ≥7h, orange 4–7h, red <4h, lavender for weekends, grey for "No Data"

---

## 3. Source data — what we have today vs what cattr has

| Concept                 | Cattr                                  | Our system                                          | Notes                                                                          |
|-------------------------|----------------------------------------|-----------------------------------------------------|--------------------------------------------------------------------------------|
| Employee → manager link | `User.manager_name` (text) + `manager_uid` (FK) | `users.team` (text)                            | We use `team` field as the grouping key. Anyone whose `team` matches a user's `fullName` is one of their direct reports. Imperfect but works without a migration. |
| Day-level time          | `TimeEntry` table aggregated per day  | `activity_sessions.active_seconds` summed per `date(started_at)` | Same shape, different granularity (per session vs per day) but rolls up cleanly. |
| Holidays                | `Holiday` table                        | ❌ none                                             | No holiday concept yet. Holiday cells deferred to v2.                          |
| Leave / sick days       | `LeaveDay` table                       | ❌ none                                             | Same — deferred to v2.                                                         |
| Activity fill (% active per minute) | `ActivityFill` table from Mira AI | ❌ none — we track keystrokes/file-saves only, not "% active" per session | Used by cattr to compute the MANUAL badge. We have a different signal — see §6. |
| Manual entry flag       | Inferred from "0% activity"           | ✅ explicit: `editor_version = 'manual-entry'` on the session | We have a cleaner signal than cattr.                                          |

**Implication:** v1 of our team-snapshot view will look ~80% like cattr's. We skip Holiday/Leave/ActivityFill cells (no source data) and use our own MANUAL signal.

---

## 4. Scope decisions

### v1 — ship this

| Feature                       | Decision     | Why                                                                |
|-------------------------------|--------------|---------------------------------------------------------------------|
| Rows × columns pivot grid     | ✅ build     | The whole point of the page                                         |
| Group employees under manager | ✅ build     | Use `users.team` as the grouping key for now                        |
| Cell color thresholds         | ✅ match cattr | green ≥7h, orange 4–7h, red <4h, grey "No Data", lavender Sat/Sun   |
| ATD column                    | ✅ build     | `active_seconds ÷ working_days_in_range`, working days = weekdays   |
| TB% badge on manager row      | ✅ build     | `(team_active_hours / (8 × num_active_employees × num_working_days)) × 100` |
| Manager header row aggregates | ✅ build     | Day columns show team average; ATD shows team average               |
| MANUAL badge                  | ✅ build     | Detect via `editor_version = 'manual-entry'` (we have this directly) |
| Date range selector           | ✅ build     | 7 / 14 / 30 day toggle, default 14                                  |
| Time format `H:MM`            | ✅ build     | Same as cattr                                                       |
| Page in sidebar               | ✅ build     | "Team snapshot" under **Organization** (admin) and **My team** (manager) |

### v2 — defer

| Feature                       | Decision     | Why                                                                |
|-------------------------------|--------------|---------------------------------------------------------------------|
| Holiday cells (light blue)    | ⏸ later      | No `holidays` table. Add later as a small feature: `holidays(date, name)` + admin UI to add. |
| Leave / sick day cells        | ⏸ later      | No `leave_days` table. Add as `leave_days(user_id, date, type)`.   |
| Activity fill % under each cell | ⏸ later    | We don't track per-minute activity %. Could be added if we record idle/active per minute. |
| Proper manager FK             | ⏸ later      | Currently uses `users.team` text matching `users.fullName`. Cleaner: add `users.manager_id` FK. Migration risk; defer. |
| "Underutilized" red highlight on manager row | ⏸ later | Cattr highlights the whole manager row red if TB < 70%. Easy to add once the badge works. |
| Per-employee status (Active / Resigned / On Leave / Notice) | ⏸ later | Cattr has a `status` field that affects whether the row is counted in TB. We don't have one. Add via `users.employment_status`. |
| Drill-down: click a cell → see that day's sessions for that user | ⏸ later | Useful but a second screen. Ship v1 read-only first. |

---

## 5. URL & navigation

- **Route:** `/team-snapshot` (Next.js page in dashboard app)
- **Sidebar entry:**
  - For **admin / super_admin**: under group "Organization" between "Daily activity" and "All projects"
  - For **manager**: under group "My team", below "Team members"
- **Empty state:** if user has no team and no admin role (i.e. plain employee navigated there directly), show "This page is for managers and admins."

---

## 6. Cell color rules

| Cell value (string)   | Class           | Background hex | Foreground hex | Trigger                                              |
|-----------------------|-----------------|----------------|----------------|-------------------------------------------------------|
| `0:00` (weekday, no data) | `time-no-data` | `#e0e0e0`     | `#666`         | weekday with no sessions                              |
| `Sunday` / `Saturday` | `time-weekend`  | `#e8eaf6`      | `#5c6bc0`      | `date.weekday() in (5, 6)`                            |
| `H:MM` where < 4h     | `time-red`      | `#ffcdd2`      | `#c62828`      | `0 < active_seconds < 4 × 3600`                       |
| `H:MM` where 4–7h     | `time-orange`   | `#ffcc80`      | `#e65100`      | `4 × 3600 ≤ active_seconds < 7 × 3600`                |
| `H:MM` where ≥7h      | `time-green`    | `#c8e6c9`      | `#1b5e20`      | `active_seconds ≥ 7 × 3600`                           |

Edge: today's date is **not** rendered as a column (cattr excludes it; rationale = the day isn't done yet, low totals would falsely look red).

---

## 7. ATD — Average Time per Day

- **Per-employee:** `active_seconds_in_range / working_days_in_range`
  - `working_days_in_range` = count of dates in the range that are Mon–Fri (weekends excluded)
  - When we add holidays + leave (v2): subtract holidays and that user's leave days too
- **Per-manager (group_header row):** average of ATDs across **active employees only**
  - `Σ(employee.active_seconds) / (num_active_employees × working_days_in_range)`
  - "Active" = not Resigned / On Leave / Notice — but since we don't have a status field yet, **everyone counts** in v1

Always formatted as `H:MM`, no leading zero on hours, two-digit minutes (`4:51`, `0:00`, `12:30`).

---

## 8. TB% — Team Bandwidth utilization

- Shown only on **manager header rows** as a colored badge: `TB: 90.9%`
- Formula: `(team_total_hours / (8 × num_active_employees × num_working_days)) × 100`
- Color thresholds:
  - `< 30%` → red `#ef5350`
  - `30%–49%` → orange `#ff9800`
  - `≥ 50%` → green `#4caf50`
- Hover tooltip: `"Team logged 142h of 168h expected (8h × 3 people × 7 days)"`

---

## 9. MANUAL badge

Shown next to an **employee** row (not manager headers). Triggered when:

```
all sessions for that user in the visible range have editor_version = 'manual-entry'
AND the user has at least one session in the range
```

If the user has even one auto-tracked session (extension or desktop tracker), no badge.

Implementation note: this is one extra column in the per-user aggregation query. Cheap.

---

## 10. Backend endpoint (planned)

`GET /api/team-snapshot?from=YYYY-MM-DD&to=YYYY-MM-DD`

Auth: `requireManager` (admin or manager).

Response shape:

```typescript
{
  dates: string[];                  // ["2026-04-29", "2026-04-28", ...] newest first, today excluded
  groups: Array<{
    managerId: string | null;       // null for "Unassigned" group
    managerName: string;            // "Anshul Verma" or "Unassigned"
    headerAtdSeconds: number;       // team average ATD
    teamBandwidthPct: number;       // 0–100+
    perDateTeamAvgSeconds: Record<string /* YYYY-MM-DD */, number>;
    employees: Array<{
      userId: string;
      fullName: string;
      email: string;
      atdSeconds: number;
      isAllManual: boolean;         // → MANUAL badge
      perDate: Record<string, {
        activeSeconds: number;
        kind: "data" | "no-data" | "weekend";
      }>;
    }>;
  }>;
}
```

Manager visibility rules (enforced server-side):
- Admin / super_admin → all groups
- Manager → only the group where `managerName === user.fullName`
- Anyone else → 403

---

## 11. Open questions for later iterations

These do NOT block v1, but worth thinking about when we revisit:

1. **What happens when a user changes manager mid-range?** Cattr has no answer. We'd need a `team_history(user_id, team, started_at, ended_at)` audit table.
2. **Should the manager's own time appear in the team aggregate?** Cattr shows it as a separate `manager_self` row visible only to super-admins. Decide based on user feedback.
3. **Half-day leave** — display `4:00` in green or in a special color? Cattr has dedicated leave types ("Half Day"). We'd need leave types when we add the `leave_days` table.
4. **Team-of-teams (nested managers).** Cattr is 2-level (manager → reports). If our org grows to managers reporting to other managers, the grid needs hierarchy.
5. **Export to CSV.** Likely the first thing an admin will ask for once the grid works.

---

## 12. Migration / new tables (when we tackle v2)

```sql
-- v2: holidays
CREATE TABLE holidays (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date         date NOT NULL UNIQUE,
  name         varchar(100) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- v2: leave days
CREATE TABLE leave_days (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date         date NOT NULL,
  leave_type   varchar(30) NOT NULL,   -- 'full', 'half', 'sick', 'paid', 'unpaid'
  note         varchar(500),
  approved_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

-- v2: optional, replaces text-based team grouping
ALTER TABLE users ADD COLUMN manager_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN employment_status varchar(20) NOT NULL DEFAULT 'active';
-- statuses: 'active' | 'on_leave' | 'notice' | 'resigned' | 'maternity'
```

Migration would be 0007–0009 in our existing numbering.

---

## 13. Reference — original cattr code locations

For when we want to compare to the original implementation:

| Component                  | File                                          | Lines       |
|----------------------------|-----------------------------------------------|-------------|
| Manager-grouped data build | `D:\cattr_dashbord\cattr_dashboard\app.py`    | 1268–1582   |
| `seconds_to_hhmm`          | `D:\cattr_dashbord\cattr_dashboard\app.py`    | 818–824     |
| `User` model + `manager_name` | `D:\cattr_dashbord\cattr_dashboard\app.py` | 153–176     |
| `get_employee_manager`     | `D:\cattr_dashbord\cattr_dashboard\app.py`    | 402–441     |
| Working-days calculation   | `D:\cattr_dashbord\cattr_dashboard\app.py`    | 1394–1437   |
| `getTimeColorClass()` JS   | `D:\cattr_dashbord\cattr_dashboard\templates\index.html` | 1133–1144 |
| Grid rendering JS          | `D:\cattr_dashbord\cattr_dashboard\templates\index.html` | 975–1131  |
| TB% calculation JS         | `D:\cattr_dashbord\cattr_dashboard\templates\index.html` | 915–969   |

---

## 14. Status

| Date       | Status                                                                               |
|------------|--------------------------------------------------------------------------------------|
| 2026-04-30 | Spec drafted. v1 scope agreed (skip Holiday / Leave / ActivityFill / proper FK). Implementation pending. |
