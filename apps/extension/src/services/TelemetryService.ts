import * as vscode from "vscode";
import type { ApiClient } from "./ApiClient";
import type { ActivityTracker } from "./ActivityTracker";
import type { ProjectPickerService } from "./ProjectPickerService";

export class TelemetryService {
  private sessionId: string | null = null;
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private apiClient: ApiClient,
    private activityTracker: ActivityTracker,
    private projectPicker?: ProjectPickerService
  ) {}

  async startSession(): Promise<string | null> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const projectSlug = workspaceFolder?.name || "unknown";

    try {
      const result = await this.apiClient.post<{ sessionId: string }>("/api/telemetry/session/start", {
        projectSlug,
        editorVersion: vscode.version,
        extensionVersion: "0.1.0",
        os: process.platform,
      });

      this.sessionId = result.sessionId;
      this.startPeriodicFlush();
      return this.sessionId;
    } catch (err) {
      // Silently fail — telemetry is not critical
      return null;
    }
  }

  async endSession(): Promise<void> {
    this.stopPeriodicFlush();

    if (this.sessionId) {
      try {
        await this.apiClient.post("/api/telemetry/session/end", { sessionId: this.sessionId });
      } catch {
        // Best effort
      }
      this.sessionId = null;
    }
  }

  private startPeriodicFlush(): void {
    const config = vscode.workspace.getConfiguration("ailancers");
    const intervalSec = config.get<number>("telemetryIntervalSeconds", 60);

    this.flushInterval = setInterval(() => this.flush(), intervalSec * 1000);
  }

  private stopPeriodicFlush(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  private async flush(): Promise<void> {
    if (!this.sessionId) return;

    const config = vscode.workspace.getConfiguration("ailancers");
    if (!config.get<boolean>("trackingEnabled", true)) return;

    const metrics = this.activityTracker.harvestMetrics();

    try {
      await this.apiClient.post("/api/telemetry/session/heartbeat", {
        sessionId: this.sessionId,
        ...metrics,
        externalProjectId: this.projectPicker?.activeProjectId ?? null,
        externalTaskId: this.projectPicker?.activeTaskId ?? null,
      });
    } catch {
      // Queue for retry on next flush — keeping simple for now
    }
  }
}
