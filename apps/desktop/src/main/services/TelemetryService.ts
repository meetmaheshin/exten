import type { ApiClient } from "./ApiClient";
import type { ActivityTracker } from "./ActivityTracker";
import type { ConfigStore } from "./ConfigStore";
import * as os from "node:os";

export class TelemetryService {
  private sessionId: string | null = null;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private activeProjectId: number | null = null;
  private activeTaskId: number | null = null;

  constructor(
    private apiClient: ApiClient,
    private activityTracker: ActivityTracker,
    private configStore: ConfigStore
  ) {}

  setActiveProject(projectId: number | null, taskId: number | null): void {
    this.activeProjectId = projectId;
    this.activeTaskId = taskId;
  }

  async startSession(): Promise<void> {
    if (this.sessionId) return;

    try {
      const resp = await this.apiClient.post<{ sessionId: string }>("/api/telemetry/session/start", {
        projectSlug: "desktop-tracker",
        editorVersion: `Electron/${process.versions.electron || "unknown"}`,
        extensionVersion: "0.1.0",
        os: os.platform(),
      });

      this.sessionId = resp.sessionId;
      console.log(`[Telemetry] Session started: ${this.sessionId}`);

      const intervalMs = this.configStore.get("telemetryIntervalSeconds") * 1000;
      this.flushInterval = setInterval(() => this.flush(), intervalMs);
    } catch (err) {
      console.error("[Telemetry] Failed to start session:", err);
    }
  }

  async endSession(): Promise<void> {
    if (!this.sessionId) return;

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Final flush
    await this.flush();

    try {
      await this.apiClient.post("/api/telemetry/session/end", {
        sessionId: this.sessionId,
      });
      console.log(`[Telemetry] Session ended: ${this.sessionId}`);
    } catch (err) {
      console.error("[Telemetry] Failed to end session:", err);
    }

    this.sessionId = null;
  }

  private async flush(): Promise<void> {
    if (!this.sessionId) return;
    if (!this.configStore.get("trackingEnabled")) return;

    const metrics = this.activityTracker.harvestMetrics();

    // Skip heartbeat if fully idle (no active seconds this interval)
    if (metrics.activeSeconds === 0 && metrics.idleSeconds > 0) {
      return;
    }

    try {
      await this.apiClient.post("/api/telemetry/session/heartbeat", {
        sessionId: this.sessionId,
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
