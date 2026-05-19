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
 *   1. Take subProjectId from PushArgs (upload route plucks it from the
 *      just-inserted screenshot row — supplied by the client at upload
 *      time, persisted on screenshots.sub_project_id). Absent → skip.
 *   2. Resolve lancer_user_id from JWT.platformUserId. If absent → skip.
 *   3. Check /hourly-billing/status (cached ~5 min). If sub-project isn't
 *      hourly / is suspended / limit reached → skip.
 *   4. Bucket capturedAt into a slot boundary using slot_duration_minutes
 *      from the cached /status response. This auto-syncs with whatever
 *      chat-ui's `hourly_billing_slot_duration_minutes` is set to — if it
 *      flips from 10 to 5 (or 15), our bucket size follows on the next
 *      cache refresh (≤5 min later). Billing math stays correct because
 *      chat-ui multiplies `accepted_slot_rows × slot_duration_minutes` —
 *      keeping the bucket width equal to chat-ui's slot length gives
 *      exactly one row per slot per (sub-project, lancer) per hour and
 *      bills the actual minutes worked, no over/under.
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

/** Positive-status TTL: re-check chat-ui every 5 min so suspended/limit_reached/slot_duration flips are seen quickly. */
const STATUS_CACHE_TTL_MS = 5 * 60 * 1000;
/** Negative TTL: when /status fails or returns non-hourly, back off briefly. Avoids hammering chat-ui on missing data without locking in stale "not hourly" for too long. */
const STATUS_NEGATIVE_TTL_MS = 60 * 1000;
/** Safety floor on slot_duration_minutes from chat-ui. Anything less than 1
 *  min is almost certainly a config bug — clamp so we never overbill at e.g.
 *  60 pushes/hour × 1 min × wildly-wrong-multiplier. Upper bound is omitted
 *  on purpose: a huge slot length just means fewer pushes, never overbill. */
const MIN_SLOT_MINUTES = 1;

interface PushArgs {
  /** screenshots.id — just persisted. */
  screenshotId: string;
  /** When the screenshot was taken (used for slot bucketing). */
  capturedAt: Date;
  /** users.id — owner of the screenshot. */
  userId: string;
  /** activity_sessions.id — used to look up per-session counters (kb, mouse). */
  sessionId: string;
  /** chat-ui sub-project this screenshot is attributed to. Comes from
   *  screenshots.sub_project_id (set by the upload route from body.subProjectId).
   *  Null/empty → skip (we don't know which sub-project to bill against). */
  subProjectId: string | null;
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
  /** Bucket width in minutes from chat-ui's /status — drives our slot
   *  bucketing so chat-ui's billing math (rows × this value) gives 60
   *  min/hour regardless of capture cadence. */
  slotDurationMinutes: number;
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
    if (!args.subProjectId) {
      // sub_project_id lives on the screenshot row (set by the upload route
      // from body.subProjectId). Clients refuse to capture when no
      // sub-project is selected, but legacy uploads or admin-injected rows
      // may still arrive without one — nothing for chat-ui to attribute.
      args.log.info(
        { screenshot_id: args.screenshotId, user_id: args.userId },
        "[HourlyBillingPusher] skip: screenshot has no subProjectId",
      );
      return;
    }
    const subProjectId = args.subProjectId;

    // Per-session counters used to compute per-slot deltas. The mouse signal
    // comes from total_mouse_events (editor-focus changes), wired in
    // migration 0015. Kb signal is total_keystrokes (already there).
    const [session] = await this.db
      .select({
        totalKeystrokes: activitySessions.totalKeystrokes,
        totalMouseEvents: activitySessions.totalMouseEvents,
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

    const status = await this.getCachedStatus(subProjectId, args.platformUserId);
    if (!status.isHourly) {
      args.log.info(
        { sub_project_id: subProjectId, lancer_user_id: args.platformUserId },
        "[HourlyBillingPusher] skip: sub-project is not hourly (or status unavailable)",
      );
      return;
    }
    if (status.suspended || status.limitReached) {
      args.log.info(
        {
          sub_project_id: subProjectId,
          lancer_user_id: args.platformUserId,
          suspended: status.suspended,
          limit_reached: status.limitReached,
        },
        "[HourlyBillingPusher] skip: billing suspended or weekly limit reached",
      );
      return;
    }

    // Bucket width comes from chat-ui's /status (cached). Whatever value
    // chat-ui's hourly_billing_slot_duration_minutes config holds is what
    // we use — keeps our claim dedup aligned with chat-ui's billing math
    // (rows × slot_duration_minutes per hour). At 5/5 every screenshot
    // pushes; at 10/5 every other screenshot pushes; at 5/10 each push is
    // a unique slot.
    const slotDurationMs = status.slotDurationMinutes * 60_000;
    const slotStartMs = Math.floor(args.capturedAt.getTime() / slotDurationMs) * slotDurationMs;
    const slotStart = new Date(slotStartMs);
    const slotStartIso = slotStart.toISOString();

    // Race-safe "claim this slot": insert a placeholder. If another push for
    // the same slot already inserted, ON CONFLICT DO NOTHING returns no row
    // and we bail.
    const claimed = await this.db
      .insert(hourlySlotPushes)
      .values({
        userId: args.userId,
        subProjectId: subProjectId,
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
          sub_project_id: subProjectId,
          slot_start: slotStartIso,
          screenshot_id: args.screenshotId,
        },
        "[HourlyBillingPusher] skip: slot already pushed (another screenshot in same bucket)",
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
          eq(hourlySlotPushes.subProjectId, subProjectId),
          lt(hourlySlotPushes.slotStart, slotStart),
        ),
      )
      .orderBy(desc(hourlySlotPushes.slotStart))
      .limit(1);

    const prevKb = prev?.keystrokesAtPush ?? 0;
    const prevMouse = prev?.mouseHitsAtPush ?? 0;
    const kbDelta = Math.max(0, session.totalKeystrokes - prevKb);
    const mouseDelta = Math.max(0, session.totalMouseEvents - prevMouse);
    // Match the extension's old activity baseline: 15 events per minute per slot
    // == 100%. Baseline scales with slot length so a 10-min slot needs 150
    // events for 100%, a 5-min slot needs 75. Clamp at 100.
    const baseline = Math.max(1, status.slotDurationMinutes * 15);
    const activityPercent = Math.min(100, Math.round(((kbDelta + mouseDelta) / baseline) * 100));

    const slotId = `${subProjectId}:${args.platformUserId}:${slotStartIso}`;
    const payload = {
      slot_id: slotId,
      sub_project_id: subProjectId,
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
          mouseHitsAtPush: session.totalMouseEvents,
          screenshotId: args.screenshotId,
          pushedAt: new Date(),
        })
        .where(
          and(
            eq(hourlySlotPushes.userId, args.userId),
            eq(hourlySlotPushes.subProjectId, subProjectId),
            eq(hourlySlotPushes.slotStart, slotStart),
          ),
        );
      args.log.info(
        {
          sub_project_id: subProjectId,
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
      const e = err as Error & { statusCode?: number; body?: string };
      // Distinguish transient vs semantic failures:
      //
      // 5xx / network: transient — chat-ui is down or flaking. Roll back
      //   the claim so the NEXT screenshot in this same slot retries the
      //   push. The 5-min capture cadence doubles as retry redundancy.
      //
      // 4xx (incl. "not hourly", "suspended", "limit reached"): semantic —
      //   chat-ui has rejected this slot on policy grounds. Retrying with
      //   the same payload will get the same 4xx, so we KEEP the claim row
      //   (subsequent screenshots in this slot become no-ops) AND
      //   invalidate the status cache so the next slot re-fetches the
      //   current billing config. Prevents thrashing chat-ui with rejected
      //   pushes when a sub-project flips HOURLY → FIXED mid-session.
      const isTransient =
        e.statusCode === undefined || // network / no HTTP response
        e.statusCode === 408 ||
        e.statusCode === 429 ||
        (e.statusCode >= 500 && e.statusCode < 600);
      if (isTransient) {
        await this.db
          .delete(hourlySlotPushes)
          .where(
            and(
              eq(hourlySlotPushes.userId, args.userId),
              eq(hourlySlotPushes.subProjectId, subProjectId),
              eq(hourlySlotPushes.slotStart, slotStart),
            ),
          );
        args.log.error(
          { slot_id: slotId, status: e.statusCode, body: e.body, message: e.message },
          "[HourlyBillingPusher] push failed (transient) — claim rolled back, will retry on next screenshot",
        );
      } else {
        // Drop the cached status so the next push re-asks chat-ui.
        this.statusCache.delete(`${subProjectId}|${args.platformUserId}`);
        args.log.error(
          { slot_id: slotId, status: e.statusCode, body: e.body, message: e.message },
          "[HourlyBillingPusher] push rejected (semantic) — claim retained, status cache invalidated",
        );
      }
    }
  }

  private async getCachedStatus(
    subProjectId: string,
    lancerUserId: string,
  ): Promise<CachedStatus> {
    const key = `${subProjectId}|${lancerUserId}`;
    const now = Date.now();
    const cached = this.statusCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached;
    }
    const fresh = await this.reporter.getStatus(subProjectId, lancerUserId);
    if (!fresh) {
      // Negative cache so we don't hammer chat-ui when it's down. Same
      // record shape as a successful "not hourly" — both cause skip. The
      // slot_duration_minutes value on this record is never read (isHourly
      // gates the push), so any positive number works as a placeholder.
      const fallback: CachedStatus = {
        isHourly: false,
        suspended: false,
        limitReached: false,
        slotDurationMinutes: MIN_SLOT_MINUTES,
        expiresAt: now + STATUS_NEGATIVE_TTL_MS,
      };
      this.statusCache.set(key, fallback);
      return fallback;
    }
    // Floor at MIN_SLOT_MINUTES — protects against a chat-ui config bug
    // returning 0 or a negative which would either crash the floor() math
    // or turn every screenshot into a unique slot (massive overbill).
    const slotDurationMinutes = Math.max(
      MIN_SLOT_MINUTES,
      Math.floor(fresh.slot_duration_minutes ?? MIN_SLOT_MINUTES),
    );
    const ttl = fresh.is_hourly ? STATUS_CACHE_TTL_MS : STATUS_NEGATIVE_TTL_MS;
    const record: CachedStatus = {
      isHourly: fresh.is_hourly,
      suspended: !!fresh.suspended,
      limitReached: !!fresh.limit_reached,
      slotDurationMinutes,
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
