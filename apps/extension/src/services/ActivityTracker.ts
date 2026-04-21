import * as vscode from "vscode";
import type { ActivitySnapshot } from "@ailancers/shared-types";
import type { SystemIdleService } from "./SystemIdleService";

export class ActivityTracker {
  private lastActivityTimestamp = Date.now();
  private _isIdle = false;
  private _wasIdle = false;
  private tickInterval: ReturnType<typeof setInterval>;
  private lastTickTimestamp = Date.now();

  private keystrokeCount = 0;
  private fileSaveCount = 0;
  private fileChangeCount = 0;
  private filesModified = new Map<string, { language: string; changes: number }>();
  private languageSeconds = new Map<string, number>();
  private activeSeconds = 0;
  private idleSeconds = 0;
  private aiRequestCount = 0;
  private systemIdleService: SystemIdleService | null;
  private idleNotificationShown = false;

  constructor(systemIdleService?: SystemIdleService) {
    this.systemIdleService = systemIdleService ?? null;
    this.tickInterval = setInterval(() => this.tick(), 1000);
  }

  /** True when OS has had no input for > 10 minutes */
  get isOsIdle(): boolean {
    return (this.systemIdleService?.osIdleSeconds ?? 0) > 600;
  }

  /** Current idle state */
  get isIdle(): boolean {
    return this._isIdle;
  }

  /** Current foreground app name */
  get activeAppName(): string {
    return this.systemIdleService?.activeWindow.appName ?? "unknown";
  }

  private tick(): void {
    const config = vscode.workspace.getConfiguration("ailancers");
    if (!config.get<boolean>("trackingEnabled", true)) return;

    const now = Date.now();
    const elapsed = Math.round((now - this.lastTickTimestamp) / 1000);
    this.lastTickTimestamp = now;

    const idleTimeoutSec = config.get<number>("idleTimeoutSeconds", 600); // default 10 min
    const osIdleSec = this.systemIdleService?.osIdleSeconds ?? 0;

    // PRIMARY: Use OS idle detection — counts ALL PC activity, not just VS Code
    // If OS says user has been idle for > threshold → they're idle
    // If OS says user is active (mouse/keyboard recently) → they're active
    if (osIdleSec >= idleTimeoutSec) {
      // User is idle — no mouse/keyboard for 10+ min
      this._isIdle = true;
      this.idleSeconds += elapsed;

      // Show idle notification once
      if (!this.idleNotificationShown) {
        this.idleNotificationShown = true;
        this.showIdleNotification();
      }
    } else {
      // User is active — OS detected recent input
      this._isIdle = false;
      this.activeSeconds += elapsed;
      this.idleNotificationShown = false;

      // If was idle and now active, show "resumed" briefly
      if (this._wasIdle && !this._isIdle) {
        vscode.window.setStatusBarMessage("$(play) Ailancers: Tracking resumed", 5000);
      }

      // Track language time if VS Code is focused
      const lang = vscode.window.activeTextEditor?.document.languageId;
      if (lang) {
        this.languageSeconds.set(lang, (this.languageSeconds.get(lang) || 0) + elapsed);
      }
    }

    this._wasIdle = this._isIdle;
  }

  private async showIdleNotification(): Promise<void> {
    const action = await vscode.window.showWarningMessage(
      "You appear to be away. Tracking is paused.",
      { modal: false },
      "Resume Work"
    );
    if (action === "Resume Work") {
      // Touch activity to resume
      this.lastActivityTimestamp = Date.now();
      this._isIdle = false;
      this.idleNotificationShown = false;
      vscode.window.setStatusBarMessage("$(play) Ailancers: Tracking resumed", 5000);
    }
  }

  onDocumentChange(e: vscode.TextDocumentChangeEvent): void {
    this.lastActivityTimestamp = Date.now();
    this.keystrokeCount += e.contentChanges.length;
    this.fileChangeCount++;

    const uri = vscode.workspace.asRelativePath(e.document.uri);
    const existing = this.filesModified.get(uri) || { language: e.document.languageId, changes: 0 };
    existing.changes++;
    this.filesModified.set(uri, existing);
  }

  onDocumentSave(_doc: vscode.TextDocument): void {
    this.lastActivityTimestamp = Date.now();
    this.fileSaveCount++;
  }

  onEditorChange(_editor: vscode.TextEditor | undefined): void {
    this.lastActivityTimestamp = Date.now();
  }

  onWindowStateChange(state: vscode.WindowState): void {
    if (state.focused) {
      this.lastActivityTimestamp = Date.now();
    }
  }

  incrementAiRequests(): void {
    this.aiRequestCount++;
  }

  getAiRequestCount(): number {
    return this.aiRequestCount;
  }

  getTotalActiveSeconds(): number {
    return this.activeSeconds;
  }

  harvestMetrics(): ActivitySnapshot {
    const snapshot: ActivitySnapshot = {
      activeSeconds: this.activeSeconds,
      idleSeconds: this.idleSeconds,
      keystrokeCount: this.keystrokeCount,
      fileSaveCount: this.fileSaveCount,
      fileChangeCount: this.fileChangeCount,
      filesModified: Object.fromEntries(this.filesModified),
      languageSeconds: Object.fromEntries(this.languageSeconds),
      isCurrentlyIdle: this._isIdle,
      appUsage: this.systemIdleService?.harvestAppUsage() ?? {},
    };

    // Reset counters
    this.activeSeconds = 0;
    this.idleSeconds = 0;
    this.keystrokeCount = 0;
    this.fileSaveCount = 0;
    this.fileChangeCount = 0;
    this.filesModified.clear();
    this.languageSeconds.clear();

    return snapshot;
  }

  dispose(): void {
    clearInterval(this.tickInterval);
  }
}
