import { app } from "electron";
import type { ApiClient } from "./ApiClient";
import { log } from "../logger";

/**
 * Polls /api/version on startup + every 6 hours, exposes whether the installed
 * desktop binary is older than the latest one the backend advertises.
 *
 * Passive UX: nothing pops up. The tray menu reads the cached state and shows
 * "v0.2.19 → v0.2.20 available" as a clickable item when behind. Users who
 * never open the menu won't be bothered.
 *
 * Backend response shape (see apps/backend/src/app.ts):
 *   { extension: { version, downloadUrl }, desktop: { version, downloadUrl } }
 *
 * Comparison is strict semver-ish: "0.2.20" > "0.2.19" by numeric components
 * left-to-right. Anything else (network error, malformed response, same
 * version) leaves `isOutdated` false so the tray stays clean.
 */
export interface UpdateState {
  current: string;          // app.getVersion() — what we're running
  latest: string | null;    // what the backend says the latest is, or null if unknown
  downloadUrl: string | null;
  isOutdated: boolean;      // true when latest > current
}

interface VersionResponse {
  desktop: { version: string; downloadUrl: string };
}

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export class UpdateCheckService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: UpdateState;
  private listeners: Array<(state: UpdateState) => void> = [];

  constructor(private apiClient: ApiClient) {
    this.state = {
      current: app.getVersion(),
      latest: null,
      downloadUrl: null,
      isOutdated: false,
    };
  }

  /** Kick off the first check + schedule the poll. Idempotent. */
  start(): void {
    if (this.timer) return;
    void this.check(); // fire once on startup
    this.timer = setInterval(() => void this.check(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  /** Subscribe to state changes. Useful for TrayManager to rebuild the menu. */
  onChange(listener: (state: UpdateState) => void): void {
    this.listeners.push(listener);
  }

  private async check(): Promise<void> {
    try {
      // /api/version is public — no auth needed. Use a raw fetch so an
      // unauthenticated user (just installed, hasn't logged in yet) can
      // still see the update prompt.
      const url = `${this.apiClient.getBaseUrl()}/api/version`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const data: VersionResponse = await resp.json();
      const latest = data.desktop?.version ?? null;
      const downloadUrl = data.desktop?.downloadUrl ?? null;
      if (!latest) return;

      const isOutdated = compareSemver(latest, this.state.current) > 0;
      const changed =
        latest !== this.state.latest ||
        isOutdated !== this.state.isOutdated;

      this.state = { ...this.state, latest, downloadUrl, isOutdated };

      if (isOutdated) {
        log.info(`[UpdateCheck] New version available: ${this.state.current} → ${latest}`);
      }

      if (changed) {
        for (const listener of this.listeners) {
          try { listener(this.state); } catch { /* listener errors don't block polling */ }
        }
      }
    } catch (err) {
      // Network failure, malformed response, etc. — leave state as-is. Next
      // poll in 6h will retry. We don't surface failure to the user; the
      // version check is best-effort polish, not a critical path.
      log.warn(`[UpdateCheck] Check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Compare two semver-ish strings. Returns >0 if a > b, <0 if a < b, 0 if equal.
 * Coerces each dotted component to an integer; non-numeric suffixes like "-rc1"
 * are stripped. Good enough for our "0.2.19" / "0.2.20" pattern.
 */
function compareSemver(a: string, b: string): number {
  const partsA = a.split(".").map((p) => parseInt(p, 10) || 0);
  const partsB = b.split(".").map((p) => parseInt(p, 10) || 0);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const x = partsA[i] ?? 0;
    const y = partsB[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}
