import { desktopCapturer, Notification } from "electron";
import { getIconPath } from "../paths";
import { log } from "../logger";
import type { ApiClient } from "./ApiClient";
import type { ActivityTracker } from "./ActivityTracker";
import type { ConfigStore } from "./ConfigStore";
import type { TelemetryService } from "./TelemetryService";

export class ScreenCaptureService {
  private captureInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private apiClient: ApiClient,
    private activityTracker: ActivityTracker,
    private configStore: ConfigStore,
    private telemetryService: TelemetryService
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

    const sessionId = this.telemetryService.sessionId;
    if (!sessionId) return;

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
      const imageBase64 = pngBuffer.toString("base64");
      const filename = `desktop-${Date.now()}.png`;

      const result = await this.apiClient.post<{ id: string }>("/api/telemetry/screenshot", {
        sessionId,
        filename,
        imageBase64,
        capturedAt: new Date().toISOString(),
      });

      log.info(`[ScreenCapture] Captured and uploaded (${(pngBuffer.length / 1024).toFixed(0)}KB) — id=${result.id}`);
      this.showCapturedNotification(result.id);
    } catch (err) {
      log.error(`[ScreenCapture] Capture failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private showCapturedNotification(screenshotId: string): void {
    if (!Notification.isSupported()) return;

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
