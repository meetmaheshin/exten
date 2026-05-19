import { desktopCapturer, nativeImage, Notification } from "electron";
import type { NativeImage } from "electron";
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
      // Capture EVERY display, not just sources[0]. On a multi-monitor setup
      // the work might be on a secondary monitor while the primary shows
      // Slack — capturing only primary leaves HR thinking the user wasn't
      // working. Stitching all displays side-by-side puts everything in
      // one PNG so reviewers see the whole workspace.
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1920, height: 1080 },
      });

      if (sources.length === 0) {
        log.warn("[ScreenCapture] No screen sources found");
        return;
      }

      const pngBuffer = stitchScreensHorizontally(sources.map((s) => s.thumbnail));

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

/**
 * Stitch N display thumbnails into one wide PNG, side-by-side, left-to-right.
 *
 * Each `desktopCapturer` source returns a NativeImage scaled to fit the
 * thumbnailSize we requested (1920×1080). On multi-monitor setups, the
 * thumbnails may have slightly different sizes (Electron preserves the
 * native aspect ratio inside the requested bounds), so we:
 *   1) read each image's raw BGRA bitmap and size
 *   2) compute the combined width and the max height
 *   3) build a single Buffer the size of the composite
 *   4) blit each source into its column, padding the bottom rows with
 *      transparent pixels when its height < the composite max height
 *
 * Returns a PNG buffer. Falls back to single-screen behavior if anything
 * goes wrong (e.g. zero-sized image) — never throws.
 */
function stitchScreensHorizontally(images: NativeImage[]): Buffer {
  if (images.length === 1) return images[0].toPNG();

  // Read raw BGRA bytes + dimensions for each image. Electron's
  // toBitmap() returns a Buffer of BGRA (NOT RGBA), 4 bytes per pixel,
  // in scanline order.
  const tiles = images.map((img) => ({
    bgra: img.toBitmap(),
    size: img.getSize(),
  })).filter((t) => t.size.width > 0 && t.size.height > 0);

  if (tiles.length === 0) return images[0].toPNG();
  if (tiles.length === 1) {
    // Defensive: only one valid display — just return that one.
    return nativeImage.createFromBitmap(tiles[0].bgra, tiles[0].size).toPNG();
  }

  const compositeWidth = tiles.reduce((sum, t) => sum + t.size.width, 0);
  const compositeHeight = tiles.reduce((max, t) => Math.max(max, t.size.height), 0);
  const composite = Buffer.alloc(compositeWidth * compositeHeight * 4); // BGRA

  let xOffset = 0;
  for (const tile of tiles) {
    const { width, height } = tile.size;
    // Copy each scanline of the source into the composite at its column.
    // Composite scanlines are compositeWidth*4 bytes; source scanlines are
    // width*4 bytes; we offset by xOffset*4 within each composite scanline.
    for (let y = 0; y < height; y++) {
      const srcStart = y * width * 4;
      const dstStart = y * compositeWidth * 4 + xOffset * 4;
      tile.bgra.copy(composite, dstStart, srcStart, srcStart + width * 4);
    }
    xOffset += width;
  }

  return nativeImage
    .createFromBitmap(composite, { width: compositeWidth, height: compositeHeight })
    .toPNG();
}
