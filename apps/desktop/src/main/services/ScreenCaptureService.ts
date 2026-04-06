import { desktopCapturer } from "electron";
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
    console.log("[ScreenCapture] Started");
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
        console.warn("[ScreenCapture] No screen sources found");
        return;
      }

      const primaryScreen = sources[0];
      const image = primaryScreen.thumbnail;
      const pngBuffer = image.toPNG();
      const imageBase64 = pngBuffer.toString("base64");
      const filename = `desktop-${Date.now()}.png`;

      await this.apiClient.post("/api/telemetry/screenshot", {
        sessionId,
        filename,
        imageBase64,
        capturedAt: new Date().toISOString(),
      });

      console.log(`[ScreenCapture] Captured and uploaded (${(pngBuffer.length / 1024).toFixed(0)}KB)`);
    } catch (err) {
      console.error("[ScreenCapture] Capture failed:", err);
    }
  }

  dispose(): void {
    this.stop();
  }
}
