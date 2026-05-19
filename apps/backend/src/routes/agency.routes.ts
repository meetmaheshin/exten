/**
 * Agency-portal endpoints exposed for chat-ui to consume.
 *
 * These routes are NOT for end-user clients — they're called server-to-
 * server from chat-ui's agency-portal backend with HMAC-signed requests.
 * The shared secret is the same `AILANCERS_BILLING_HMAC_SECRET` already
 * used by the outbound billing reporter; chat-ui signs, vscode-ext
 * verifies.
 *
 *   GET /api/agency/tracker-hours
 *     ?subProjectId=<platform sub-project UUID>
 *     &from=<ISO date>
 *     &to=<ISO date>
 *     [&email=<filter to one lancer>]
 *
 * Returns one row per lancer with:
 *   { localUserId, email, fullName, screenshotCount, estimatedMinutes }
 *
 * Hours formula: `screenshotCount × SCREENSHOT_INTERVAL_MINUTES`, treating
 * every captured screenshot as proof-of-presence for one capture interval.
 * Matches the platform-wide "tracker hours" definition agreed in the
 * agency design (see chat-ui's planning notes) — works uniformly for
 * HOURLY, FIXED, SUBSCRIPTION_USAGE and CAMPAIGN sub-projects, because
 * it doesn't depend on chat-ui's billing model at all.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Env } from "../config/env.js";
import type { Database } from "../config/database.js";
import { screenshots, users } from "../models/index.js";
import { verifyBillingHmac } from "../utils/hmacVerify.js";

/** Tracker capture interval — must match `screenCaptureIntervalSeconds`
 *  default in the extension + desktop trackers (currently 300 seconds /
 *  5 minutes). If trackers ever ship with a different interval AND the
 *  user can configure it locally, this constant becomes wrong for those
 *  users — at that point we'd need to start storing the configured
 *  interval on each screenshot row. For now, 5 min is correct for all
 *  shipped clients. */
const SCREENSHOT_INTERVAL_MINUTES = 5;

const querySchema = z.object({
  subProjectId: z.string().min(1).max(64),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  email: z.string().email().optional(),
});

export function agencyRoutes(app: FastifyInstance, env: Env, db: Database) {
  // HMAC pre-handler — runs before route handler, fails fast on bad sig.
  // GET request so we sign over an empty body. See utils/hmacVerify.ts
  // for the contract.
  const requireHmac = async (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    if (!env.AILANCERS_BILLING_HMAC_SECRET) {
      request.log.error("[agency] HMAC secret not configured — refusing all agency requests");
      return reply.status(503).send({ error: "Agency API not configured" });
    }
    const result = verifyBillingHmac(request, env.AILANCERS_BILLING_HMAC_SECRET, "");
    if (!result.ok) {
      request.log.warn(
        {
          reason: result.reason,
          ts: request.headers["x-billing-timestamp"],
          sig_present: !!request.headers["x-billing-signature"],
        },
        "[agency] HMAC verification failed",
      );
      return reply.status(401).send({ error: "Invalid signature" });
    }
  };

  // ── GET /api/agency/tracker-hours ─────────────────────────────────
  app.get(
    "/api/agency/tracker-hours",
    { preHandler: requireHmac },
    async (request, reply) => {
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Bad query",
          message: parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "),
        });
      }
      const q = parsed.data;

      // Build WHERE clauses. sub_project_id is required; from/to/email
      // optional. Soft-deleted screenshots excluded so payroll-impacting
      // reads stay consistent with the rest of the app.
      const conditions = [
        eq(screenshots.subProjectId, q.subProjectId),
        isNull(screenshots.deletedAt),
      ];
      if (q.from) conditions.push(gte(screenshots.capturedAt, new Date(q.from)));
      if (q.to) conditions.push(lte(screenshots.capturedAt, new Date(q.to)));
      if (q.email) conditions.push(eq(users.email, q.email));

      // GROUP BY lancer (local user). Returns the join'd user fields so
      // chat-ui can correlate by email without a second lookup. Email is
      // the bridge between vscode-ext's local users and chat-ui's
      // platform users — both systems share the email column for any
      // user that's logged in via the platform proxy.
      const rows = await db
        .select({
          localUserId: users.id,
          email: users.email,
          fullName: users.fullName,
          screenshotCount: sql<number>`count(${screenshots.id})::int`,
        })
        .from(screenshots)
        .innerJoin(users, eq(users.id, screenshots.userId))
        .where(and(...conditions))
        .groupBy(users.id, users.email, users.fullName)
        .orderBy(sql`count(${screenshots.id}) desc`);

      const data = rows.map((r) => ({
        localUserId: r.localUserId,
        email: r.email,
        fullName: r.fullName,
        screenshotCount: r.screenshotCount,
        estimatedMinutes: r.screenshotCount * SCREENSHOT_INTERVAL_MINUTES,
      }));

      request.log.info(
        {
          sub_project_id: q.subProjectId,
          lancers: data.length,
          total_screenshots: data.reduce((acc, r) => acc + r.screenshotCount, 0),
        },
        "[agency.tracker-hours] OK",
      );

      return reply.send({
        sub_project_id: q.subProjectId,
        from: q.from ?? null,
        to: q.to ?? null,
        screenshot_interval_minutes: SCREENSHOT_INTERVAL_MINUTES,
        data,
      });
    },
  );
}
