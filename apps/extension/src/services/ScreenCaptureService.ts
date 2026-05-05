import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ApiClient } from "./ApiClient";
import type { ActivityTracker } from "./ActivityTracker";

const execFileAsync = promisify(execFile);

export interface ScreenCaptureConfig {
  /** Enable periodic screenshots */
  enabled: boolean;
  /** Interval between captures in seconds */
  intervalSeconds: number;
  /** Max local screenshots to keep before cleanup */
  maxLocalScreenshots: number;
  /** Whether to blur/redact sensitive areas */
  blurSensitive: boolean;
}

const DEFAULT_CONFIG: ScreenCaptureConfig = {
  enabled: true,
  intervalSeconds: 300, // every 5 minutes
  maxLocalScreenshots: 50,
  blurSensitive: false,
};

interface PendingUpload {
  filePath: string;
  capturedAt: string;
  metadata: Record<string, unknown>;
  attempts: number;
}

const MAX_QUEUE_SIZE = 20;     // Cap memory; oldest dropped if exceeded
const MAX_ATTEMPTS = 5;        // After this many failed retries, give up on a screenshot
const MAX_QUEUE_AGE_MS = 30 * 60 * 1000; // Don't keep a screenshot in the queue more than 30 minutes

export class ScreenCaptureService implements vscode.Disposable {
  private captureInterval: ReturnType<typeof setInterval> | null = null;
  private screenshotDir: string;
  private sessionId: string | null = null;
  private isCapturing = false;
  /** Failed uploads waiting to retry. Drained at the start of each capture cycle. */
  private retryQueue: PendingUpload[] = [];

  constructor(
    private extensionContext: vscode.ExtensionContext,
    private apiClient: ApiClient,
    private activityTracker?: ActivityTracker
  ) {
    this.screenshotDir = path.join(extensionContext.globalStorageUri.fsPath, "screenshots");
  }

  async start(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    const config = this.getConfig();
    if (!config.enabled) return;

    // Ensure screenshot directory exists
    await fs.promises.mkdir(this.screenshotDir, { recursive: true });

    // Take an initial screenshot
    await this.captureAndUpload();

    // Start periodic captures
    this.captureInterval = setInterval(
      () => this.captureAndUpload(),
      config.intervalSeconds * 1000
    );
  }

  stop(): void {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    this.sessionId = null;
  }

  /** Manually trigger a screenshot capture */
  async captureNow(): Promise<string | null> {
    return this.captureAndUpload();
  }

  private getConfig(): ScreenCaptureConfig {
    const vsConfig = vscode.workspace.getConfiguration("ailancers");
    return {
      enabled: vsConfig.get<boolean>("screenCaptureEnabled", DEFAULT_CONFIG.enabled),
      intervalSeconds: vsConfig.get<number>("screenCaptureIntervalSeconds", DEFAULT_CONFIG.intervalSeconds),
      maxLocalScreenshots: vsConfig.get<number>("screenCaptureMaxLocal", DEFAULT_CONFIG.maxLocalScreenshots),
      blurSensitive: vsConfig.get<boolean>("screenCaptureBlurSensitive", DEFAULT_CONFIG.blurSensitive),
    };
  }

  private async captureAndUpload(): Promise<string | null> {
    if (this.isCapturing || !this.sessionId) return null;

    this.isCapturing = true;

    try {
      // 1. Drain retry queue first — uploads that previously failed get another shot
      // before we even take a new screenshot. This way an offline period followed
      // by reconnect catches up everything that was queued during the outage.
      await this.drainRetryQueue();

      // 2. Skip a fresh capture when the user is idle. Note: we still drain the
      // queue above, so if an idle period followed a network outage the queued
      // shots still get uploaded — they're not held hostage by the idle skip.
      if (this.activityTracker?.isIdle) {
        return null;
      }

      const filePath = await this.takeScreenshot();
      if (!filePath) return null;

      const capturedAt = new Date().toISOString();
      const metadata = {
        activeEditor: vscode.window.activeTextEditor?.document.uri.fsPath
          ? vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri)
          : null,
        language: vscode.window.activeTextEditor?.document.languageId ?? null,
      };

      // 3. Try the upload. On failure, push to retry queue instead of dropping.
      const screenshotId = await this.tryUpload({ filePath, capturedAt, metadata, attempts: 1 });

      // 4. Show notification with delete option (only on successful upload)
      if (screenshotId) {
        const action = await vscode.window.showInformationMessage(
          "Screenshot captured",
          { detail: "A screenshot was taken and uploaded.", modal: false },
          "Delete"
        );
        if (action === "Delete") {
          try {
            await this.apiClient.fetch(`/api/telemetry/screenshots/${screenshotId}`, { method: "DELETE" });
            vscode.window.showInformationMessage("Screenshot deleted. Time for this interval will not be counted.");
          } catch {
            vscode.window.showErrorMessage("Failed to delete screenshot.");
          }
        }
      }

      // 5. Cleanup old local screenshots — but never delete a file that's still
      // in the retry queue, otherwise retries would 404 reading the file.
      await this.cleanupLocalScreenshots();

      return filePath;
    } catch (err) {
      console.error("Screen capture failed:", err);
      return null;
    } finally {
      this.isCapturing = false;
    }
  }

  /**
   * Try to upload one pending screenshot. On success returns the server's id;
   * on failure adds it to the retry queue (or increments attempts if already
   * there). Returns null on failure.
   */
  private async tryUpload(item: PendingUpload): Promise<string | null> {
    if (!this.sessionId) return null;

    try {
      const fileBuffer = await fs.promises.readFile(item.filePath);
      const base64Data = fileBuffer.toString("base64");
      const filename = path.basename(item.filePath);

      const resp = await this.apiClient.post<{ id: string }>("/api/telemetry/screenshot", {
        sessionId: this.sessionId,
        filename,
        imageBase64: base64Data,
        capturedAt: item.capturedAt,
        metadata: item.metadata,
      });
      return resp.id || null;
    } catch (err) {
      // ENOENT or read failure → file is gone, drop without queuing
      const errCode = (err as { code?: string })?.code;
      if (errCode === "ENOENT") {
        console.warn(`[ScreenCapture] File missing for queued upload: ${item.filePath}`);
        return null;
      }

      console.warn(`[ScreenCapture] Upload failed (attempt ${item.attempts}): ${err instanceof Error ? err.message : String(err)}`);

      // Queue for retry if we haven't exhausted attempts and the file is reasonably young.
      const ageMs = Date.now() - new Date(item.capturedAt).getTime();
      if (item.attempts < MAX_ATTEMPTS && ageMs < MAX_QUEUE_AGE_MS) {
        // Don't double-queue if it's already there (drainRetryQueue picked it up)
        const existing = this.retryQueue.find((q) => q.filePath === item.filePath);
        if (existing) {
          existing.attempts = item.attempts + 1;
        } else {
          this.retryQueue.push({ ...item, attempts: item.attempts + 1 });
          // Cap queue size — drop oldest if over the limit
          while (this.retryQueue.length > MAX_QUEUE_SIZE) {
            this.retryQueue.shift();
          }
        }
      } else {
        console.warn(`[ScreenCapture] Giving up on ${item.filePath} after ${item.attempts} attempts (age ${Math.round(ageMs / 1000)}s)`);
      }
      return null;
    }
  }

  /** Drain the retry queue. Called at the start of every capture cycle. */
  private async drainRetryQueue(): Promise<void> {
    if (this.retryQueue.length === 0) return;

    // Snapshot the queue so we don't loop forever on re-queues
    const items = [...this.retryQueue];
    this.retryQueue = [];

    for (const item of items) {
      const ageMs = Date.now() - new Date(item.capturedAt).getTime();
      if (ageMs > MAX_QUEUE_AGE_MS) {
        console.warn(`[ScreenCapture] Dropping queued screenshot — too old (${Math.round(ageMs / 1000)}s)`);
        continue;
      }
      await this.tryUpload(item); // Failed retries will re-add themselves to the queue
    }
  }

  private async takeScreenshot(): Promise<string | null> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `screenshot-${timestamp}.png`;
    const filePath = path.join(this.screenshotDir, filename);

    const platform = os.platform();

    try {
      if (platform === "win32") {
        await this.captureWindows(filePath);
      } else if (platform === "darwin") {
        await this.captureMac(filePath);
      } else {
        await this.captureLinux(filePath);
      }

      // Verify file exists
      await fs.promises.access(filePath, fs.constants.F_OK);
      return filePath;
    } catch (err) {
      console.error("Screenshot capture error:", err);
      return null;
    }
  }

  private async captureWindows(outputPath: string): Promise<void> {
    // Use PowerShell to capture the active window screenshot
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing

      $screen = [System.Windows.Forms.Screen]::PrimaryScreen
      $bounds = $screen.Bounds
      $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
      $bitmap.Save('${outputPath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
      $graphics.Dispose()
      $bitmap.Dispose()
    `.trim();

    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      psScript,
    ], { timeout: 10_000 });
  }

  private async captureMac(outputPath: string): Promise<void> {
    // macOS has built-in screencapture command
    await execFileAsync("screencapture", ["-x", "-C", outputPath], {
      timeout: 10_000,
    });
  }

  private async captureLinux(outputPath: string): Promise<void> {
    // Try multiple tools in order of preference
    const tools = [
      { cmd: "gnome-screenshot", args: ["-f", outputPath] },
      { cmd: "scrot", args: [outputPath] },
      { cmd: "import", args: ["-window", "root", outputPath] }, // ImageMagick
    ];

    for (const tool of tools) {
      try {
        await execFileAsync(tool.cmd, tool.args, { timeout: 10_000 });
        return;
      } catch {
        continue;
      }
    }

    throw new Error("No screenshot tool available. Install gnome-screenshot, scrot, or imagemagick.");
  }

  // Note: the previous uploadScreenshot() helper was inlined into tryUpload()
  // because the retry queue needs full control over capturedAt + metadata.

  private async cleanupLocalScreenshots(): Promise<void> {
    const config = this.getConfig();

    try {
      const files = await fs.promises.readdir(this.screenshotDir);
      const pngFiles = files
        .filter((f) => f.endsWith(".png"))
        .sort(); // sorted by timestamp in filename

      if (pngFiles.length > config.maxLocalScreenshots) {
        // Don't delete files that are waiting for retry — would 404 the next attempt
        const queuedBasenames = new Set(this.retryQueue.map((q) => path.basename(q.filePath)));
        const toDelete = pngFiles
          .slice(0, pngFiles.length - config.maxLocalScreenshots)
          .filter((f) => !queuedBasenames.has(f));
        for (const file of toDelete) {
          await fs.promises.unlink(path.join(this.screenshotDir, file)).catch(() => {});
        }
      }
    } catch {
      // Cleanup failures are not critical
    }
  }

  dispose(): void {
    this.stop();
  }
}
