import type { ApiClient } from "./ApiClient";
import type { ActivityTracker } from "./ActivityTracker";
import type { ConfigStore } from "./ConfigStore";
import * as os from "node:os";

export interface TelemetryFlushResult {
  activeSeconds: number;
  idleSeconds: number;
}

export class TelemetryService {
  private _sessionId: string | null = null;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private activeProjectId: number | null = null;
  private activeTaskId: number | null = null;
  private onFlushCallback: ((result: TelemetryFlushResult) => void) | null = null;

  constructor(
    private apiClient: ApiClient,
    private activityTracker: ActivityTracker,
    private configStore: ConfigStore
  ) {}

  get sessionId(): string | null {
    return this._sessionId;
  }

  /** Register a callback that fires after each successful heartbeat flush */
  onFlush(cb: (result: TelemetryFlushResult) => void): void {
    this.onFlushCallback = cb;
  }

  setActiveProject(projectId: number | null, taskId: number | null): void {
    this.activeProjectId = projectId;
    this.activeTaskId = taskId;
  }

  async startSession(): Promise<void> {
    if (this._sessionId) return;

    try {
      const resp = await this.apiClient.post<{ sessionId: string }>("/api/telemetry/session/start", {
        projectSlug: "desktop-tracker",
        editorVersion: `Electron/${process.versions.electron || "unknown"}`,
        extensionVersion: "0.1.0",
        os: os.platform(),
      });

      this._sessionId = resp.sessionId;
      console.log(`[Telemetry] Session started: ${this._sessionId}`);

      const intervalMs = this.configStore.get("telemetryIntervalSeconds") * 1000;
      this.flushInterval = setInterval(() => this.flush(), intervalMs);
    } catch (err) {
      console.error("[Telemetry] Failed to start session:", err);
    }
  }

  async endSession(): Promise<void> {
    if (!this._sessionId) return;

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Final flush
    await this.flush();

    try {
      await this.apiClient.post("/api/telemetry/session/end", {
        sessionId: this._sessionId,
      });
      console.log(`[Telemetry] Session ended: ${this._sessionId}`);
    } catch (err) {
      console.error("[Telemetry] Failed to end session:", err);
    }

    this._sessionId = null;
  }

  private async flush(): Promise<void> {
    if (!this._sessionId) return;
    if (!this.configStore.get("trackingEnabled")) return;

    const metrics = this.activityTracker.harvestMetrics();

    // Skip heartbeat if fully idle (no active seconds this interval)
    if (metrics.activeSeconds === 0 && metrics.idleSeconds > 0) {
      return;
    }

    try {
      await this.apiClient.post("/api/telemetry/session/heartbeat", {
        sessionId: this._sessionId,
        activeSeconds: metrics.activeSeconds,
        idleSeconds: metrics.idleSeconds,
        keystrokeCount: 0,
        fileSaveCount: 0,
        fileChangeCount: 0,
        filesModified: {},
        languageSeconds: {},
        isCurrentlyIdle: metrics.isCurrentlyIdle,
        externalProjectId: this.activeProjectId,
        externalTaskId: this.activeTaskId,
        appUsage: metrics.appUsage,
      });

      // Notify caller (tray) of successful flush
      if (this.onFlushCallback) {
        this.onFlushCallback({
          activeSeconds: metrics.activeSeconds,
          idleSeconds: metrics.idleSeconds,
        });
      }
    } catch (err) {
      console.error("[Telemetry] Heartbeat failed:", err);
    }
  }

  dispose(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }
}
