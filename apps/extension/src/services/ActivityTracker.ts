import * as vscode from "vscode";
import type { ActivitySnapshot } from "@ailancers/shared-types";
import type { SystemIdleService } from "./SystemIdleService";

export class ActivityTracker {
  private lastActivityTimestamp = Date.now();
  private isIdle = false;
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

  constructor(systemIdleService?: SystemIdleService) {
    this.systemIdleService = systemIdleService ?? null;
    this.tickInterval = setInterval(() => this.tick(), 1000);
  }

  /** True when OS has had no input for > 10 minutes */
  get isOsIdle(): boolean {
    return (this.systemIdleService?.osIdleSeconds ?? 0) > 600;
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

    const idleThreshold = config.get<number>("idleTimeoutSeconds", 300) * 1000;
    const osIdleSec = this.systemIdleService?.osIdleSeconds ?? 0;

    // Use OS idle as primary signal; fall back to VS Code activity tracking
    // OS idle > 10 min = definitely idle (even if VS Code events fire from background processes)
    if (osIdleSec > 600 || now - this.lastActivityTimestamp > idleThreshold) {
      this.isIdle = true;
      this.idleSeconds += elapsed;
    } else {
      this.isIdle = false;
      this.activeSeconds += elapsed;

      const lang = vscode.window.activeTextEditor?.document.languageId;
      if (lang) {
        this.languageSeconds.set(lang, (this.languageSeconds.get(lang) || 0) + elapsed);
      }
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
      isCurrentlyIdle: this.isIdle,
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
