import type { ApiClient } from "./ApiClient";
import type { ActivityTracker } from "./ActivityTracker";
import type { ConfigStore } from "./ConfigStore";
import { log } from "../logger";
import * as os from "node:os";

export interface TelemetryFlushResult {
  activeSeconds: number;
  idleSeconds: number;
}

export class TelemetryService {
  private _sessionId: string | null = null;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private activeProjectId: string | null = null;
  private activeTaskId: string | null = null;
  private activeProjectName: string | null = null;
  private activeTaskName: string | null = null;
  private onFlushCallback: ((result: TelemetryFlushResult) => void) | null = null;

  constructor(
    private apiClient: ApiClient,
    private activityTracker: ActivityTracker,
    private configStore: ConfigStore
  ) {}

  get sessionId(): string | null {
    return this._sessionId;
  }

  onFlush(cb: (result: TelemetryFlushResult) => void): void {
    this.onFlushCallback = cb;
  }

  setActiveProject(projectId: string | null, taskId: string | null, projectName?: string | null, taskName?: string | null): void {
    this.activeProjectId = projectId;
    this.activeTaskId = taskId;
    this.activeProjectName = projectName ?? null;
    this.activeTaskName = taskName ?? null;
  }

  /** Fetch today's total active seconds from the backend (for tray timer restore) */
  async fetchTodayActiveSeconds(): Promise<number> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const resp = await this.apiClient.get<{
        data: { totalActiveSeconds: number };
      }>(`/api/activity/me/summary?from=${today.toISOString()}`);
      const seconds = resp.data?.totalActiveSeconds || 0;
      log.info(`[Telemetry] fetchTodayActiveSeconds → ${seconds}s (${Math.round(seconds / 60)}m)`);
      return seconds;
    } catch (err) {
      log.error(`[Telemetry] fetchTodayActiveSeconds failed: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
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
      const intervalMs = this.configStore.get("telemetryIntervalSeconds") * 1000;
      log.info(`[Telemetry] Session started: ${this._sessionId} (heartbeat every ${intervalMs / 1000}s)`);
      this.flushInterval = setInterval(() => this.flush(), intervalMs);
    } catch (err) {
      log.error(`[Telemetry] Failed to start session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async endSession(): Promise<void> {
    if (!this._sessionId) return;

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    await this.flush();

    try {
      await this.apiClient.post("/api/telemetry/session/end", {
        sessionId: this._sessionId,
      });
      log.info(`[Telemetry] Session ended: ${this._sessionId}`);
    } catch (err) {
      log.error(`[Telemetry] Failed to end session: ${err instanceof Error ? err.message : String(err)}`);
    }

    this._sessionId = null;
  }

  private async flush(): Promise<void> {
    if (!this._sessionId) {
      log.warn("[Telemetry] flush() skipped — no active session");
      return;
    }
    if (!this.configStore.get("trackingEnabled")) {
      log.warn("[Telemetry] flush() skipped — trackingEnabled=false in config");
      return;
    }

    const metrics = this.activityTracker.harvestMetrics();

    // Skip heartbeat only if nothing happened at all
    if (metrics.activeSeconds === 0 && metrics.idleSeconds === 0) {
      log.info("[Telemetry] flush() skipped — no activity since last heartbeat");
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
        projectName: this.activeProjectName,
        taskName: this.activeTaskName,
        appUsage: metrics.appUsage,
      });

      log.info(
        `[Telemetry] Heartbeat OK — active=${metrics.activeSeconds}s idle=${metrics.idleSeconds}s ` +
        `project=${this.activeProjectName ?? "—"} session=${this._sessionId}`
      );

      if (this.onFlushCallback) {
        this.onFlushCallback({
          activeSeconds: metrics.activeSeconds,
          idleSeconds: metrics.idleSeconds,
        });
      }
    } catch (err) {
      log.error(
        `[Telemetry] Heartbeat FAILED — active=${metrics.activeSeconds}s idle=${metrics.idleSeconds}s ` +
        `session=${this._sessionId} error=${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  dispose(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }
}
