import { desktopCapturer, app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import type { ApiClient } from "./ApiClient";
import type { ActivityTracker } from "./ActivityTracker";
import type { ConfigStore } from "./ConfigStore";

export class ScreenCaptureService {
  private captureInterval: ReturnType<typeof setInterval> | null = null;
  private localDir: string;

  constructor(
    private apiClient: ApiClient,
    private activityTracker: ActivityTracker,
    private configStore: ConfigStore
  ) {
    this.localDir = path.join(app.getPath("userData"), "screenshots");
    if (!fs.existsSync(this.localDir)) {
      fs.mkdirSync(this.localDir, { recursive: true });
    }
  }

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

      // Upload to backend
      await this.upload(pngBuffer);

      console.log(`[ScreenCapture] Captured and uploaded (${(pngBuffer.length / 1024).toFixed(0)}KB)`);
    } catch (err) {
      console.error("[ScreenCapture] Capture failed:", err);
    }
  }

  private async upload(pngBuffer: Buffer): Promise<void> {
    const base64 = pngBuffer.toString("base64");
    const filename = `desktop-${Date.now()}.png`;

    try {
      const resp = await this.apiClient.fetch("/api/telemetry/screenshot", {
        method: "POST",
        body: JSON.stringify({
          filename,
          image: base64,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!resp.ok) {
        console.error("[ScreenCapture] Upload failed:", resp.status);
      }
    } catch (err) {
      console.error("[ScreenCapture] Upload error:", err);
    }
  }

  dispose(): void {
    this.stop();
  }
}
