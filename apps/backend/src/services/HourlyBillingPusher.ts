/**
 * HourlyBillingPusher — pushes a chat-ui snapshot per screenshot upload.
 *
 * Replaces the per-client `HourlyBillingTracker` design where each editor /
 * tracker app aggregated slots locally and called chat-ui directly. Moving
 * the push to this backend means every current and future client (extension,
 * desktop, future mobile) is just a dumb uploader: send screenshot + counters,
 * the backend decides the rest.
 *
 * Flow (called fire-and-forget from /api/telemetry/screenshot after the row
 * is persisted):
 *
 *   1. Resolve session.subProjectId (set on heartbeats). If absent → skip.
 *   2. Resolve lancer_user_id from JWT.platformUserId. If absent → skip.
 *   3. Check /hourly-billing/status (cached ~5 min). If sub-project isn't
 *      hourly / is suspended / limit reached → skip.
 *   4. Bucket capturedAt into a 10-min slot boundary. (We intentionally
 *      ignore chat-ui's dynamic slot_duration_minutes — using a fixed
 *      bucket keeps both sides aligned as long as chat-ui's default stays
 *      10 min, which it does today. If it changes, update SLOT_DURATION_MS.)
 *   5. INSERT a placeholder row into hourly_slot_pushes with ON CONFLICT DO
 *      NOTHING. If another push for the same slot won the race, skip.
 *   6. Compute per-slot deltas: (session.totalKeystrokes - previous slot's
 *      keystrokesAtPush) for kb, same for mouse hits. Clamp at 0 in case
 *      counters reset (e.g. session restart).
 *   7. Build payload, sign via reporter.pushSnapshot(). On success, UPDATE
 *      the placeholder row with current counters + screenshot_id. On
 *      failure, DELETE the placeholder so the next screenshot retries.
 *
 * chat-ui dedups by slot_id, so the placeholder INSERT already prevents
 * us from sending redundant pushes for the same slot. The placeholder lets
 * us tell the difference between "first push, do it" and "subsequent push
 * in same slot, skip" without any chat-ui round-trip.
 */
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { Database } from "../config/database.js";
import type { HourlyTrackerReporter, TrackerStatusResponse } from "./HourlyTrackerReporter.js";
import { activitySessions, hourlySlotPushes } from "../models/index.js";

/** Slot bucket width in milliseconds. See file header for why this is fixed. */
const SLOT_DURATION_MS = 10 * 60 * 1000;
/** Positive-status TTL: re-check chat-ui every 5 min so suspended/limit_reached flips are seen quickly. */
const STATUS_CACHE_TTL_MS = 5 * 60 * 1000;
/** Negative TTL: when /status fails or returns non-hourly, back off briefly. Avoids hammering chat-ui on missing data without locking in stale "not hourly" for too long. */
const STATUS_NEGATIVE_TTL_MS = 60 * 1000;

interface PushArgs {
  /** screenshots.id — just persisted. */
  screenshotId: string;
  /** When the screenshot was taken (used for slot bucketing). */
  capturedAt: Date;
  /** users.id — owner of the screenshot. */
  userId: string;
  /** activity_sessions.id — used to look up the active sub-project + counters. */
  sessionId: string;
  /** JWT platformUserId — chat-ui's lancer_user_id. Required; logs and skips if missing. */
  platformUserId: string | null;
  /** Absolute public URL chat-ui can render the screenshot at. */
  screenshotUrl: string;
  /** Fastify request logger — keeps push logs in the same context as the uploading request. */
  log: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
}

interface CachedStatus {
  isHourly: boolean;
  suspended: boolean;
  limitReached: boolean;
  expiresAt: number;
}

export class HourlyBillingPusher {
  private statusCache = new Map<string, CachedStatus>();

  constructor(
    private db: Database,
    private reporter: HourlyTrackerReporter,
  ) {}

  /**
   * Push attempt is best-effort: returns void, never throws, errors logged.
   * Caller wraps in `void this.tryPush(...)` to avoid blocking the upload
   * response.
   */
  async tryPush(args: PushArgs): Promise<void> {
    try {
      await this.run(args);
    } catch (err) {
      args.log.error(
        {
          err: err instanceof Error ? err.message : String(err),
          screenshot_id: args.screenshotId,
        },
        "[HourlyBillingPusher] unexpected failure",
      );
    }
  }

  private async run(args: PushArgs): Promise<void> {
    if (!this.reporter.isEnabled()) return;
    if (!args.platformUserId) {
      args.log.info(
        { screenshot_id: args.screenshotId, user_id: args.userId },
        "[HourlyBillingPusher] skip: no platformUserId on caller (local-only account)",
      );
      return;
    }

    // Read session.subProjectId + counters in one round-trip.
    const [session] = await this.db
      .select({
        subProjectId: activitySessions.subProjectId,
        totalKeystrokes: activitySessions.totalKeystrokes,
        totalMouseHits: activitySessions.totalMouseHits,
      })
      .from(activitySessions)
      .where(eq(activitySessions.id, args.sessionId))
      .limit(1);

    if (!session) {
      args.log.warn(
        { session_id: args.sessionId },
        "[HourlyBillingPusher] skip: session not found",
      );
      return;
    }
    if (!session.subProjectId) {
      // Most common skip path until clients start sending subProjectId on
      // heartbeats. Logged at debug-equivalent (info) so it doesn't spam.
      args.log.info(
        { session_id: args.sessionId },
        "[HourlyBillingPusher] skip: session has no subProjectId — heartbeat hasn't reported one yet",
      );
      return;
    }

    const status = await this.getCachedStatus(session.subProjectId, args.platformUserId);
    if (!status.isHourly) {
      args.log.info(
        { sub_project_id: session.subProjectId, lancer_user_id: args.platformUserId },
        "[HourlyBillingPusher] skip: sub-project is not hourly (or status unavailable)",
      );
      return;
    }
    if (status.suspended || status.limitReached) {
      args.log.info(
        {
          sub_project_id: session.subProjectId,
          lancer_user_id: args.platformUserId,
          suspended: status.suspended,
          limit_reached: status.limitReached,
        },
        "[HourlyBillingPusher] skip: billing suspended or weekly limit reached",
      );
      return;
    }

    // 10-min slot bucket. floor(capturedAt / SLOT) * SLOT.
    const slotStartMs = Math.floor(args.capturedAt.getTime() / SLOT_DURATION_MS) * SLOT_DURATION_MS;
    const slotStart = new Date(slotStartMs);
    const slotStartIso = slotStart.toISOString();

    // Race-safe "claim this slot": insert a placeholder. If another push for
    // the same slot already inserted, ON CONFLICT DO NOTHING returns no row
    // and we bail.
    const claimed = await this.db
      .insert(hourlySlotPushes)
      .values({
        userId: args.userId,
        subProjectId: session.subProjectId,
        slotStart,
        lancerUserId: args.platformUserId,
        keystrokesAtPush: 0,
        mouseHitsAtPush: 0,
        screenshotId: null,
      })
      .onConflictDoNothing()
      .returning({ slotStart: hourlySlotPushes.slotStart });

    if (claimed.length === 0) {
      args.log.info(
        {
          sub_project_id: session.subProjectId,
          slot_start: slotStartIso,
          screenshot_id: args.screenshotId,
        },
        "[HourlyBillingPusher] skip: slot already pushed (another screenshot in same 10-min window)",
      );
      return;
    }

    // Per-slot deltas: subtract counters at the previous successful push.
    // Clamp at 0 in case the session restarted and totals reset.
    const [prev] = await this.db
      .select({
        keystrokesAtPush: hourlySlotPushes.keystrokesAtPush,
        mouseHitsAtPush: hourlySlotPushes.mouseHitsAtPush,
      })
      .from(hourlySlotPushes)
      .where(
        and(
          eq(hourlySlotPushes.userId, args.userId),
          eq(hourlySlotPushes.subProjectId, session.subProjectId),
          lt(hourlySlotPushes.slotStart, slotStart),
        ),
      )
      .orderBy(desc(hourlySlotPushes.slotStart))
      .limit(1);

    const prevKb = prev?.keystrokesAtPush ?? 0;
    const prevMouse = prev?.mouseHitsAtPush ?? 0;
    const kbDelta = Math.max(0, session.totalKeystrokes - prevKb);
    const mouseDelta = Math.max(0, session.totalMouseHits - prevMouse);
    // Match the extension's old activity baseline: 15 events per minute per slot
    // == 100%. Clamp at 100.
    const slotMinutes = SLOT_DURATION_MS / 60_000;
    const baseline = Math.max(1, slotMinutes * 15);
    const activityPercent = Math.min(100, Math.round(((kbDelta + mouseDelta) / baseline) * 100));

    const slotId = `${session.subProjectId}:${args.platformUserId}:${slotStartIso}`;
    const payload = {
      slot_id: slotId,
      sub_project_id: session.subProjectId,
      lancer_user_id: args.platformUserId,
      slot_start: slotStartIso,
      screenshot_url: args.screenshotUrl,
      screenshot_taken_at: args.capturedAt.toISOString(),
      keyboard_hits: kbDelta,
      mouse_hits: mouseDelta,
      activity_percent: activityPercent,
      memo: null,
      active_window: null,
    };

    try {
      const resp = await this.reporter.pushSnapshot(payload);
      // Backfill the claim row with counters + screenshot_id + bumped pushed_at.
      await this.db
        .update(hourlySlotPushes)
        .set({
          keystrokesAtPush: session.totalKeystrokes,
          mouseHitsAtPush: session.totalMouseHits,
          screenshotId: args.screenshotId,
          pushedAt: new Date(),
        })
        .where(
          and(
            eq(hourlySlotPushes.userId, args.userId),
            eq(hourlySlotPushes.subProjectId, session.subProjectId),
            eq(hourlySlotPushes.slotStart, slotStart),
          ),
        );
      args.log.info(
        {
          sub_project_id: session.subProjectId,
          lancer_user_id: args.platformUserId,
          slot_id: slotId,
          kb: kbDelta,
          mouse: mouseDelta,
          activity_percent: activityPercent,
          is_hourly: resp.is_hourly,
          billing_status: resp.billing_status,
        },
        "[HourlyBillingPusher] pushed snapshot",
      );
    } catch (err) {
      // Roll back the claim so the next screenshot in this slot will retry.
      await this.db
        .delete(hourlySlotPushes)
        .where(
          and(
            eq(hourlySlotPushes.userId, args.userId),
            eq(hourlySlotPushes.subProjectId, session.subProjectId),
            eq(hourlySlotPushes.slotStart, slotStart),
          ),
        );
      const e = err as Error & { statusCode?: number; body?: string };
      args.log.error(
        {
          slot_id: slotId,
          status: e.statusCode,
          body: e.body,
          message: e.message,
        },
        "[HourlyBillingPusher] push failed — claim rolled back, will retry on next screenshot",
      );
    }
  }

  private async getCachedStatus(
    subProjectId: string,
    lancerUserId: string,
  ): Promise<{ isHourly: boolean; suspended: boolean; limitReached: boolean }> {
    const key = `${subProjectId}|${lancerUserId}`;
    const now = Date.now();
    const cached = this.statusCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached;
    }
    const fresh = await this.reporter.getStatus(subProjectId, lancerUserId);
    if (!fresh) {
      // Negative cache so we don't hammer chat-ui when it's down. Same
      // record shape as a successful "not hourly" — both cause skip.
      const fallback: CachedStatus = {
        isHourly: false,
        suspended: false,
        limitReached: false,
        expiresAt: now + STATUS_NEGATIVE_TTL_MS,
      };
      this.statusCache.set(key, fallback);
      return fallback;
    }
    // Note: deliberately not reading fresh.slot_duration_minutes — see file
    // header comment. SLOT_DURATION_MS is our authority.
    const ttl = fresh.is_hourly ? STATUS_CACHE_TTL_MS : STATUS_NEGATIVE_TTL_MS;
    const record: CachedStatus = {
      isHourly: fresh.is_hourly,
      suspended: !!fresh.suspended,
      limitReached: !!fresh.limit_reached,
      expiresAt: now + ttl,
    };
    this.statusCache.set(key, record);
    return record;
  }

  /** Test/admin helper — clears the in-process status cache. */
  clearStatusCache(): void {
    this.statusCache.clear();
  }
}

// Re-export for callers that want to type-narrow.
export type { TrackerStatusResponse };
