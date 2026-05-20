import { app, Notification, shell } from "electron";
import type { ApiClient } from "./ApiClient";
import { getIconPath } from "../paths";
import { log } from "../logger";

/**
 * Polls /api/version every 30 minutes, exposes whether the installed
 * desktop binary is older than what the backend advertises, AND nags the
 * user with a notification every 30 min while outdated.
 *
 * Cadence policy (decided with user):
 *   - First poll on startup
 *   - Every 30 min after that
 *   - First "update available" notification is audible; subsequent ones
 *     are silent (less annoying for users who already saw it)
 *   - User can click "Download Update" to open the dashboard download
 *     page — that silences notifications until next launch (assume they
 *     are acting on it)
 *   - User can click "Remind me later" to snooze for 2 hours
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

const POLL_INTERVAL_MS = 30 * 60 * 1000;          // 30 minutes — check + nag
const SNOOZE_INTERVAL_MS = 2 * 60 * 60 * 1000;     // "Remind me later" = 2 hours

export class UpdateCheckService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: UpdateState;
  private listeners: Array<(state: UpdateState) => void> = [];
  // Notification suppression — set when the user clicks "Download" (until
  // app restart) or "Remind me later" (timestamp = when nag may resume).
  private suppressedUntilRestart = false;
  private suppressedUntilMs = 0;
  // Tracks whether we've already shown the AUDIBLE first-notification so
  // subsequent nags can be silent for the same update version.
  private notifiedForVersion: string | null = null;

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
        this.maybeNotify();
      }

      if (changed) {
        for (const listener of this.listeners) {
          try { listener(this.state); } catch { /* listener errors don't block polling */ }
        }
      }
    } catch (err) {
      // Network failure, malformed response, etc. — leave state as-is. Next
      // poll in 30 min will retry. We don't surface failure to the user; the
      // version check is best-effort polish, not a critical path.
      log.warn(`[UpdateCheck] Check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Fire the "update available" notification if not suppressed. */
  private maybeNotify(): void {
    if (!Notification.isSupported()) return;
    if (this.suppressedUntilRestart) return;
    if (Date.now() < this.suppressedUntilMs) return;
    if (!this.state.latest || !this.state.isOutdated) return;

    // First notification for THIS specific version is audible; if the user
    // ignores it and we cycle around again, subsequent ones for the same
    // version target are silent. New version → re-arms audible.
    const isFirstForThisVersion = this.notifiedForVersion !== this.state.latest;
    this.notifiedForVersion = this.state.latest;

    const notif = new Notification({
      title: `Update available: v${this.state.latest}`,
      body: `You're on v${this.state.current}. New features and fixes are waiting. Click to download.`,
      icon: getIconPath(),
      silent: !isFirstForThisVersion,
      actions: [
        { type: "button", text: "Download" },
        { type: "button", text: "Remind me later" },
      ],
    });

    const handleDownload = () => {
      if (this.state.downloadUrl) shell.openExternal(this.state.downloadUrl);
      // Assume the user is going to install — silence until next restart so
      // we don't keep poking while they're handling it.
      this.suppressedUntilRestart = true;
    };
    const handleSnooze = () => {
      this.suppressedUntilMs = Date.now() + SNOOZE_INTERVAL_MS;
      log.info(`[UpdateCheck] Snoozed for 2h (until ${new Date(this.suppressedUntilMs).toISOString()})`);
    };

    notif.on("action", (_event, index) => {
      // index 0 = Download, 1 = Remind me later. Windows/Linux don't always
      // surface action buttons, so we also wire the toast click itself to
      // Download (the most likely intent).
      if (index === 0) handleDownload();
      else if (index === 1) handleSnooze();
    });
    notif.on("click", handleDownload);
    notif.show();
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
