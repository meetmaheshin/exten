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

export class ScreenCaptureService implements vscode.Disposable {
  private captureInterval: ReturnType<typeof setInterval> | null = null;
  private screenshotDir: string;
  private sessionId: string | null = null;
  private isCapturing = false;

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

    // Skip screenshot when OS is idle (no input for 10+ min)
    if (this.activityTracker?.isOsIdle) return null;

    this.isCapturing = true;

    try {
      const filePath = await this.takeScreenshot();
      if (!filePath) return null;

      // Upload to backend
      await this.uploadScreenshot(filePath);

      // Cleanup old local screenshots
      await this.cleanupLocalScreenshots();

      return filePath;
    } catch (err) {
      // Screen capture is non-critical, log and continue
      console.error("Screen capture failed:", err);
      return null;
    } finally {
      this.isCapturing = false;
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

  private async uploadScreenshot(filePath: string): Promise<void> {
    if (!this.sessionId) return;

    const fileBuffer = await fs.promises.readFile(filePath);
    const base64Data = fileBuffer.toString("base64");
    const filename = path.basename(filePath);

    try {
      await this.apiClient.post("/api/telemetry/screenshot", {
        sessionId: this.sessionId,
        filename,
        imageBase64: base64Data,
        capturedAt: new Date().toISOString(),
        metadata: {
          activeEditor: vscode.window.activeTextEditor?.document.uri.fsPath
            ? vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri)
            : null,
          language: vscode.window.activeTextEditor?.document.languageId ?? null,
        },
      });
    } catch (err) {
      // Upload failures are not critical
      console.error("Screenshot upload failed:", err);
    }
  }

  private async cleanupLocalScreenshots(): Promise<void> {
    const config = this.getConfig();

    try {
      const files = await fs.promises.readdir(this.screenshotDir);
      const pngFiles = files
        .filter((f) => f.endsWith(".png"))
        .sort(); // sorted by timestamp in filename

      if (pngFiles.length > config.maxLocalScreenshots) {
        const toDelete = pngFiles.slice(0, pngFiles.length - config.maxLocalScreenshots);
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
