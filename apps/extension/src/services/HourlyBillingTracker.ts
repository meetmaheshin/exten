import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ApiClient } from "./ApiClient";
import type { AuthService } from "./AuthService";
import type { ProjectPickerService } from "./ProjectPickerService";
import type { ActivityTracker } from "./ActivityTracker";

const execFileAsync = promisify(execFile);

/**
 * HourlyBillingTracker — Upwork-style activity tracker for HOURLY sub-projects.
 *
 * Lifecycle (per-slot):
 *   1. fetch GET /api/tracker/status (proxy → chat-ui /hourly-billing/status)
 *   2. if is_hourly && billing_status == ACTIVE && !suspended && !limit_reached:
 *        align to next slot boundary (slot_duration_minutes from server)
 *        wait until slot_start
 *        track keystrokes / focus events for the duration
 *        at a random moment in the middle 80% of the slot, capture a screenshot
 *        on slot_end:
 *          - upload screenshot to /api/telemetry/screenshot (existing endpoint, returns id)
 *          - build screenshot_url = `${apiBase}/api/tracker/screenshots/${id}` (PUBLIC, no auth)
 *          - POST /api/tracker/snapshot {slot_id, counters, screenshot_url, ...}
 *          - inspect response for suspended / limit_reached / is_hourly:false
 *   3. if response is fine, schedule the next slot
 *
 * Counter ownership:
 *   This service maintains its OWN keystroke / focus-event counters scoped to
 *   the active slot. It does NOT call ActivityTracker.harvestMetrics() (that
 *   resets counters and is owned by TelemetryService).
 *
 * Screenshot capture:
 *   Uses platform-specific commands directly (screencapture / PowerShell /
 *   gnome-screenshot) so it does not interfere with ScreenCaptureService's
 *   own 5-minute auto-loop. Local PNG is deleted immediately after upload.
 */

interface TrackerStatus {
  billing_status: string;
  enabled: boolean;
  weekly_hours_used: number;
  weekly_hour_limit: number;
  hours_remaining: number;
  weekly_spend_estimate?: number;
  hourly_rate?: number;
  suspended?: boolean;
  limit_reached?: boolean;
  is_hourly: boolean;
  slot_duration_minutes: number;
  lancer_user_id: string | null;
}

interface ActiveSlot {
  subProjectId: string;
  lancerUserId: string;
  slotStart: Date;
  slotEnd: Date;
  slotDurationMinutes: number;
  keyboardHits: number;
  mouseHits: number;
  screenshotUrl: string | null;
  screenshotTakenAt: Date | null;
  screenshotScheduled: boolean;
  activeWindow: string | null;
}

export class HourlyBillingTracker implements vscode.Disposable {
  private isStarted = false;
  private currentSubProjectId: string | null = null;
  private cachedStatus: TrackerStatus | null = null;
  private slot: ActiveSlot | null = null;
  private slotTimer: ReturnType<typeof setTimeout> | null = null;
  private screenshotTimer: ReturnType<typeof setTimeout> | null = null;
  private statusPollInterval: ReturnType<typeof setInterval> | null = null;
  private telemetrySessionId: string | null = null;
  private screenshotDir: string;
  private disposables: vscode.Disposable[] = [];
  private outputChannel: vscode.OutputChannel | null = null;

  constructor(
    extensionContext: vscode.ExtensionContext,
    private apiClient: ApiClient,
    private authService: AuthService,
    private projectPicker: ProjectPickerService,
    // Read-only — used for the OS-idle check; we never call harvestMetrics().
    private activityTracker: ActivityTracker,
  ) {
    this.screenshotDir = path.join(
      extensionContext.globalStorageUri.fsPath,
      "hourly-tracker-screenshots",
    );
    this.disposables.push(
      this.projectPicker.onDidChange((sel) => {
        this.handleSelectionChange(sel?.subProjectId ?? null).catch((err) =>
          this.log(`onDidChange error: ${err}`),
        );
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.onKeystroke(e)),
      vscode.window.onDidChangeActiveTextEditor((e) => this.onEditorChange(e)),
    );
    this.outputChannel =
      ((globalThis as Record<string, unknown>).__ailancersOutput as
        | vscode.OutputChannel
        | undefined) ?? null;
  }

  /**
   * Set the telemetry session id (used to upload screenshots via the existing
   * /api/telemetry/screenshot endpoint, which validates the session belongs to
   * the user). Call this after `TelemetryService.startSession()` resolves.
   */
  setTelemetrySessionId(id: string | null): void {
    this.telemetrySessionId = id;
  }

  /** Cached status snapshot (for the status bar). */
  get status(): TrackerStatus | null {
    return this.cachedStatus;
  }

  /** True when an active slot loop is running. */
  get isTracking(): boolean {
    return this.slot !== null;
  }

  /** Start the tracker. Reads the currently selected sub-project and decides whether to begin tracking. */
  async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;
    const subProjectId = this.projectPicker.activeSubProjectId;
    if (subProjectId) {
      await this.handleSelectionChange(subProjectId);
    }
  }

  /** Stop everything (logout, deactivate). */
  stop(): void {
    this.isStarted = false;
    this.stopSlotLoop();
    this.stopStatusPolling();
    this.currentSubProjectId = null;
    this.cachedStatus = null;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  private async handleSelectionChange(newSubProjectId: string | null): Promise<void> {
    if (newSubProjectId === this.currentSubProjectId) return;
    this.stopSlotLoop();
    this.stopStatusPolling();
    this.cachedStatus = null;
    this.currentSubProjectId = newSubProjectId;

    if (!newSubProjectId) {
      this.log("No sub-project selected — tracker idle");
      return;
    }
    const status = await this.fetchStatus(newSubProjectId);
    if (!status) {
      this.log(`Failed to fetch tracker status for ${newSubProjectId}`);
      return;
    }
    this.cachedStatus = status;

    if (!status.is_hourly) {
      this.log(`Sub-project ${newSubProjectId} is not HOURLY — tracker stays off`);
      return;
    }
    if (status.suspended || status.billing_status === "SUSPENDED") {
      this.log(`Sub-project ${newSubProjectId} is SUSPENDED — polling for resume`);
      vscode.window.showWarningMessage(
        "Ailancers tracker: hourly billing is suspended (payment failed). Tracking will resume once payment is restored.",
      );
      this.startStatusPolling();
      return;
    }
    if (status.billing_status !== "ACTIVE") {
      this.log(`Sub-project ${newSubProjectId} billing_status=${status.billing_status} — tracker off`);
      return;
    }
    if (status.limit_reached) {
      vscode.window.showWarningMessage(
        `Ailancers tracker: weekly hour limit reached (${status.weekly_hours_used}/${status.weekly_hour_limit} hrs). Tracking will resume next week.`,
      );
      return;
    }
    if (!status.lancer_user_id) {
      this.log("Status response missing lancer_user_id — tracker off");
      return;
    }

    this.log(
      `Starting tracker for sp=${newSubProjectId}, slot=${status.slot_duration_minutes}min, ` +
        `used=${status.weekly_hours_used}/${status.weekly_hour_limit}h`,
    );
    this.beginSlot(newSubProjectId, status.lancer_user_id, status.slot_duration_minutes);
  }

  // ─── Slot loop ──────────────────────────────────────────────────────────

  private stopSlotLoop(): void {
    if (this.slotTimer) {
      clearTimeout(this.slotTimer);
      this.slotTimer = null;
    }
    if (this.screenshotTimer) {
      clearTimeout(this.screenshotTimer);
      this.screenshotTimer = null;
    }
    this.slot = null;
  }

  /**
   * Begin a slot. Always rounds UP to the next wall-clock boundary so the
   * first slot is always full — chat-ui counts each snapshot as a complete
   * slot's worth of billable minutes, so partials would inflate the limit.
   */
  private beginSlot(
    subProjectId: string,
    lancerUserId: string,
    slotDurationMinutes: number,
  ): void {
    const slotMs = slotDurationMinutes * 60_000;
    const now = Date.now();
    const slotStart = new Date(Math.ceil(now / slotMs) * slotMs);
    const slotEnd = new Date(slotStart.getTime() + slotMs);

    this.slot = {
      subProjectId,
      lancerUserId,
      slotStart,
      slotEnd,
      slotDurationMinutes,
      keyboardHits: 0,
      mouseHits: 0,
      screenshotUrl: null,
      screenshotTakenAt: null,
      screenshotScheduled: false,
      activeWindow: this.getActiveWindow(),
    };

    const msUntilSlotStart = Math.max(0, slotStart.getTime() - now);
    const msUntilSlotEnd = msUntilSlotStart + slotMs;

    // Random moment within middle 80% of the slot for the screenshot
    const screenshotOffsetMs = slotMs * 0.1 + Math.random() * slotMs * 0.8;
    const screenshotDelayMs = msUntilSlotStart + screenshotOffsetMs;

    this.screenshotTimer = setTimeout(() => {
      this.captureScreenshotForCurrentSlot().catch((err) =>
        this.log(`screenshot capture failed: ${err}`),
      );
    }, screenshotDelayMs);

    this.slotTimer = setTimeout(() => {
      this.finalizeCurrentSlot().catch((err) => this.log(`finalize slot failed: ${err}`));
    }, msUntilSlotEnd);

    this.log(
      `Slot scheduled: ${slotStart.toISOString()} → ${slotEnd.toISOString()} ` +
        `(starts in ${Math.round(msUntilSlotStart / 1000)}s, screenshot in ${Math.round(screenshotDelayMs / 1000)}s)`,
    );
  }

  private async captureScreenshotForCurrentSlot(): Promise<void> {
    if (!this.slot || this.slot.screenshotScheduled) return;
    this.slot.screenshotScheduled = true;

    // Skip if OS is idle
    if (this.activityTracker.isOsIdle) {
      this.log("Skipping screenshot — OS idle");
      return;
    }

    let filePath: string | null = null;
    try {
      filePath = await this.takeScreenshot();
      if (!filePath || !this.slot) return;

      const fileBuffer = await fs.promises.readFile(filePath);
      const base64Data = fileBuffer.toString("base64");

      // Upload to existing /api/telemetry/screenshot endpoint
      const id = await this.uploadScreenshot(base64Data, path.basename(filePath));
      if (!id || !this.slot) return;

      // Build the public URL the chat-ui dashboard will use to render the image
      const apiBase = this.authService.getServerUrl();
      const url = `${apiBase}/api/tracker/screenshots/${id}`;
      this.slot.screenshotUrl = url;
      this.slot.screenshotTakenAt = new Date();
      this.log(`Screenshot uploaded: ${url}`);
    } catch (err) {
      this.log(`Screenshot capture/upload failed: ${err}`);
    } finally {
      // Best-effort delete of the local temp file
      if (filePath) {
        fs.promises.unlink(filePath).catch(() => {});
      }
    }
  }

  private async uploadScreenshot(base64Data: string, filename: string): Promise<string | null> {
    if (!this.telemetrySessionId) {
      this.log("No telemetry sessionId — cannot upload screenshot");
      return null;
    }
    try {
      const result = await this.apiClient.post<{ id: string }>(
        "/api/telemetry/screenshot",
        {
          sessionId: this.telemetrySessionId,
          filename,
          imageBase64: base64Data,
          capturedAt: new Date().toISOString(),
          metadata: {
            tracker: "hourly_billing",
            slotId: this.slot
              ? `${this.slot.subProjectId}:${this.slot.lancerUserId}:${this.slot.slotStart.toISOString()}`
              : null,
          },
        },
      );
      return result.id;
    } catch (err) {
      this.log(`Upload to /api/telemetry/screenshot failed: ${err}`);
      return null;
    }
  }

  private async finalizeCurrentSlot(): Promise<void> {
    if (!this.slot) return;
    const slot = this.slot;
    this.slot = null;
    if (this.slotTimer) {
      clearTimeout(this.slotTimer);
      this.slotTimer = null;
    }
    if (this.screenshotTimer) {
      clearTimeout(this.screenshotTimer);
      this.screenshotTimer = null;
    }

    const totalEvents = slot.keyboardHits + slot.mouseHits;
    const baseline = Math.max(1, slot.slotDurationMinutes * 15);
    const activityPercent = Math.min(100, Math.round((totalEvents / baseline) * 100));

    const payload = {
      slot_id: `${slot.subProjectId}:${slot.lancerUserId}:${slot.slotStart.toISOString()}`,
      sub_project_id: slot.subProjectId,
      lancer_user_id: slot.lancerUserId,
      slot_start: slot.slotStart.toISOString(),
      screenshot_url: slot.screenshotUrl,
      screenshot_taken_at: slot.screenshotTakenAt
        ? slot.screenshotTakenAt.toISOString()
        : null,
      keyboard_hits: slot.keyboardHits,
      mouse_hits: slot.mouseHits,
      activity_percent: activityPercent,
      memo: slot.activeWindow,
      active_window: slot.activeWindow,
    };

    this.log(
      `Finalizing slot: kb=${slot.keyboardHits}, mouse=${slot.mouseHits}, ` +
        `activity=${activityPercent}%, screenshot=${slot.screenshotUrl ? "yes" : "no"}`,
    );

    try {
      const status = await this.apiClient.post<TrackerStatus>(
        "/api/tracker/snapshot",
        payload,
      );
      this.cachedStatus = status;
      this.handleSnapshotResponse(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`Snapshot push failed: ${message}`);
      if (/HTTP 4/i.test(message)) {
        vscode.window.showWarningMessage(
          `Ailancers tracker stopped: ${this.extractDetail(message)}`,
        );
        this.stopSlotLoop();
        return;
      }
      // Network / 5xx — keep going, schedule next slot
      this.scheduleNextSlot();
    }
  }

  private handleSnapshotResponse(status: TrackerStatus): void {
    if (!status.is_hourly) {
      vscode.window.showInformationMessage(
        "Ailancers tracker stopped: sub-project is no longer hourly.",
      );
      this.stopSlotLoop();
      return;
    }
    if (status.suspended || status.billing_status === "SUSPENDED") {
      vscode.window.showWarningMessage(
        "Ailancers tracker stopped: hourly billing is suspended (payment failed).",
      );
      this.stopSlotLoop();
      this.startStatusPolling();
      return;
    }
    if (status.limit_reached) {
      vscode.window.showWarningMessage(
        `Ailancers tracker stopped: weekly limit reached (${status.weekly_hours_used}/${status.weekly_hour_limit} hrs).`,
      );
      this.stopSlotLoop();
      return;
    }
    if (status.billing_status !== "ACTIVE" || !status.lancer_user_id) {
      this.log(`Server says billing_status=${status.billing_status} — stopping`);
      this.stopSlotLoop();
      return;
    }
    this.scheduleNextSlot();
  }

  private scheduleNextSlot(): void {
    if (!this.currentSubProjectId || !this.cachedStatus?.lancer_user_id) return;
    this.beginSlot(
      this.currentSubProjectId,
      this.cachedStatus.lancer_user_id,
      this.cachedStatus.slot_duration_minutes,
    );
  }

  // ─── Status polling (when SUSPENDED) ────────────────────────────────────

  private startStatusPolling(): void {
    if (this.statusPollInterval) return;
    this.log("Starting status polling (every 3 min)");
    this.statusPollInterval = setInterval(
      () => this.pollStatus().catch(() => {}),
      3 * 60 * 1000,
    );
  }

  private stopStatusPolling(): void {
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval);
      this.statusPollInterval = null;
    }
  }

  private async pollStatus(): Promise<void> {
    if (!this.currentSubProjectId) {
      this.stopStatusPolling();
      return;
    }
    const status = await this.fetchStatus(this.currentSubProjectId);
    if (!status) return;
    this.cachedStatus = status;
    if (
      status.is_hourly &&
      status.billing_status === "ACTIVE" &&
      !status.suspended &&
      !status.limit_reached &&
      status.lancer_user_id
    ) {
      this.log("Status poll: ACTIVE — resuming tracker");
      this.stopStatusPolling();
      this.beginSlot(
        this.currentSubProjectId,
        status.lancer_user_id,
        status.slot_duration_minutes,
      );
    }
  }

  // ─── HTTP ───────────────────────────────────────────────────────────────

  private async fetchStatus(subProjectId: string): Promise<TrackerStatus | null> {
    try {
      return await this.apiClient.get<TrackerStatus>(
        `/api/tracker/status?subProjectId=${encodeURIComponent(subProjectId)}`,
      );
    } catch (err) {
      this.log(`fetchStatus failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  // ─── Platform-specific screenshot capture ───────────────────────────────
  // Self-contained so we don't have to touch ScreenCaptureService.

  private async takeScreenshot(): Promise<string | null> {
    await fs.promises.mkdir(this.screenshotDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(this.screenshotDir, `slot-${timestamp}.png`);
    const platform = os.platform();
    try {
      if (platform === "win32") {
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -AssemblyName System.Drawing
          $screen = [System.Windows.Forms.Screen]::PrimaryScreen
          $bounds = $screen.Bounds
          $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
          $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
          $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
          $bitmap.Save('${filePath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
          $graphics.Dispose()
          $bitmap.Dispose()
        `.trim();
        await execFileAsync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", psScript],
          { timeout: 10_000 },
        );
      } else if (platform === "darwin") {
        await execFileAsync("screencapture", ["-x", "-C", filePath], { timeout: 10_000 });
      } else {
        // Linux: try in order of preference
        const tools: Array<[string, string[]]> = [
          ["gnome-screenshot", ["-f", filePath]],
          ["scrot", [filePath]],
          ["import", ["-window", "root", filePath]],
        ];
        let captured = false;
        for (const [cmd, args] of tools) {
          try {
            await execFileAsync(cmd, args, { timeout: 10_000 });
            captured = true;
            break;
          } catch {
            continue;
          }
        }
        if (!captured) {
          throw new Error("No screenshot tool available (gnome-screenshot/scrot/import)");
        }
      }
      await fs.promises.access(filePath, fs.constants.F_OK);
      return filePath;
    } catch (err) {
      this.log(`takeScreenshot error: ${err}`);
      return null;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private getActiveWindow(): string | null {
    return vscode.window.activeTextEditor?.document.uri
      ? vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri)
      : null;
  }

  private onKeystroke(e: vscode.TextDocumentChangeEvent): void {
    if (!this.slot) return;
    this.slot.keyboardHits += e.contentChanges.length;
  }

  private onEditorChange(_editor: vscode.TextEditor | undefined): void {
    if (!this.slot) return;
    this.slot.mouseHits += 1;
    this.slot.activeWindow = this.getActiveWindow();
  }

  private extractDetail(message: string): string {
    const match = message.match(/"message":"([^"]+)"/);
    return match ? match[1] : message;
  }

  private log(msg: string): void {
    if (this.outputChannel) {
      this.outputChannel.appendLine(`[HourlyBillingTracker] ${msg}`);
    } else {
      console.log(`[HourlyBillingTracker] ${msg}`);
    }
  }

  dispose(): void {
    this.stop();
    for (const d of this.disposables) d.dispose();
  }
}
