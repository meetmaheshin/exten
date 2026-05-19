import { desktopCapturer, Notification } from "electron";
import { getIconPath } from "../paths";
import { log } from "../logger";
import type { ApiClient } from "./ApiClient";
import type { ActivityTracker } from "./ActivityTracker";
import type { ConfigStore } from "./ConfigStore";
import type { TelemetryService } from "./TelemetryService";
import type { ProjectService } from "./ProjectService";

export class ScreenCaptureService {
  private captureInterval: ReturnType<typeof setInterval> | null = null;
  /** Last time the "no project selected" warning was shown — throttled to
   *  one per 15 min so the 5-min capture cadence doesn't spam the user. */
  private lastNoProjectWarnAt = 0;
  private static readonly NO_PROJECT_WARN_INTERVAL_MS = 15 * 60 * 1000;

  constructor(
    private apiClient: ApiClient,
    private activityTracker: ActivityTracker,
    private configStore: ConfigStore,
    private telemetryService: TelemetryService,
    private projectService: ProjectService,
  ) {}

  start(): void {
    if (this.captureInterval) return;
    const intervalMs = this.configStore.get("screenCaptureIntervalSeconds") * 1000;
    this.captureInterval = setInterval(() => this.capture(), intervalMs);
    log.info(`[ScreenCapture] Started (every ${intervalMs / 1000}s)`);
  }

  stop(): void {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
  }

  private async capture(): Promise<void> {
    if (!this.configStore.get("screenCaptureEnabled")) return;
    if (this.activityTracker.isIdle) return;
    // Don't capture the lock screen — useless for HR review and creepy.
    if (this.activityTracker.isScreenLocked) return;

    const sessionId = this.telemetryService.sessionId;
    if (!sessionId) return;

    // Sub-project gate: every screenshot must be attributed to a sub-project
    // for chat-ui billing. If none is selected, refuse the capture and warn
    // the user — throttled to one notification per 15 min.
    const subProjectId = this.projectService.activeSubProjectId;
    if (!subProjectId) {
      const now = Date.now();
      if (now - this.lastNoProjectWarnAt > ScreenCaptureService.NO_PROJECT_WARN_INTERVAL_MS) {
        this.lastNoProjectWarnAt = now;
        if (Notification.isSupported()) {
          new Notification({
            title: "Ailancers Tracker",
            body: "No sub-project selected. Your time is NOT being counted. Right-click the tray icon → Select Project/Task.",
            icon: getIconPath(),
          }).show();
        }
      }
      log.warn("[ScreenCapture] Skipping capture — no sub-project selected");
      return;
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1920, height: 1080 },
      });

      if (sources.length === 0) {
        log.warn("[ScreenCapture] No screen sources found");
        return;
      }

      const primaryScreen = sources[0];
      const image = primaryScreen.thumbnail;
      const pngBuffer = image.toPNG();

      // Blank-image filter: PNG's DEFLATE compresses solid colors to almost
      // nothing. A legitimate 1080p screenshot is 200KB-2MB+; a blank/black
      // PNG is usually under 20KB. Drop tiny captures — payroll won't credit
      // the interval and the user isn't owed pay for an empty screen.
      const BLANK_SIZE_THRESHOLD = 20 * 1024;
      if (pngBuffer.length < BLANK_SIZE_THRESHOLD) {
        log.warn(`[ScreenCapture] Dropping suspected blank capture (${pngBuffer.length} bytes)`);
        return;
      }

      const imageBase64 = pngBuffer.toString("base64");
      const filename = `desktop-${Date.now()}.png`;

      const result = await this.apiClient.post<{ id: string }>("/api/telemetry/screenshot", {
        sessionId,
        filename,
        imageBase64,
        capturedAt: new Date().toISOString(),
        subProjectId,
      });

      log.info(`[ScreenCapture] Captured and uploaded (${(pngBuffer.length / 1024).toFixed(0)}KB) — id=${result.id}`);
      this.showCapturedNotification(result.id);
    } catch (err) {
      log.error(`[ScreenCapture] Capture failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private showCapturedNotification(screenshotId: string): void {
    if (!Notification.isSupported()) return;
    // User can turn this off via the tray menu — useful for people who find
    // the per-5-min toast distracting. Delete via /my-screenshots still works.
    if (!this.configStore.get("screenshotNotificationsEnabled")) return;

    const notification = new Notification({
      title: "Screenshot captured",
      body: "Click to delete if you don't want this screenshot counted.",
      icon: getIconPath(),
      actions: [{ type: "button", text: "Delete" }],
      silent: true,
    });

    const handleDelete = async () => {
      try {
        await this.apiClient.fetch(`/api/telemetry/screenshots/${screenshotId}`, { method: "DELETE" });
        new Notification({
          title: "Screenshot deleted",
          body: "Time for this interval will not be counted.",
          silent: true,
        }).show();
      } catch (err) {
        log.error(`[ScreenCapture] Delete failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    notification.on("action", handleDelete);
    // Windows/Linux don't surface action buttons — clicking the toast itself deletes
    notification.on("click", handleDelete);
    notification.show();
  }

  dispose(): void {
    this.stop();
  }
}
