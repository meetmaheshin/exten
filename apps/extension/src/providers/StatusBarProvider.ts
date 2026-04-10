import * as vscode from "vscode";
import type { AuthService } from "../services/AuthService";
import type { ActivityTracker } from "../services/ActivityTracker";
import type { ProjectPickerService } from "../services/ProjectPickerService";
import type { HourlyBillingTracker } from "../services/HourlyBillingTracker";

export class StatusBarProvider implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private projectBarItem: vscode.StatusBarItem;
  private trackerBarItem: vscode.StatusBarItem;
  private updateInterval: ReturnType<typeof setInterval>;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private authService: AuthService,
    private activityTracker: ActivityTracker,
    private projectPicker: ProjectPickerService,
    private hourlyBillingTracker?: HourlyBillingTracker,
  ) {
    // Left side: time + AI requests
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = "ailancers.openChat";

    // Left side (next to it): active project/task
    this.projectBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.projectBarItem.command = "ailancers.selectProject";

    // Hourly billing tracker state — only shown for HOURLY sub-projects
    this.trackerBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    this.trackerBarItem.command = "ailancers.openChat";

    this.refresh();
    this.statusBarItem.show();
    this.projectBarItem.show();

    this.updateInterval = setInterval(() => this.refresh(), 30_000);

    // Immediately refresh when project selection changes
    this.disposables.push(
      projectPicker.onDidChange(() => this.refresh())
    );
  }

  refresh(): void {
    if (!this.authService.isAuthenticated) {
      this.statusBarItem.text = "$(comment-discussion) Ailancers: Sign In";
      this.statusBarItem.tooltip = "Click to sign in to Ailancers Code";
      this.statusBarItem.command = "ailancers.login";
      this.projectBarItem.hide();
      this.trackerBarItem.hide();
      return;
    }

    const totalSeconds = this.activityTracker.getTotalActiveSeconds();
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    const aiRequests = this.activityTracker.getAiRequestCount();

    this.statusBarItem.text = `$(clock) ${timeStr} | $(comment-discussion) ${aiRequests} AI`;
    this.statusBarItem.tooltip = `Active time: ${timeStr}\nAI requests: ${aiRequests}\nClick to open chat`;
    this.statusBarItem.command = "ailancers.openChat";

    // Project / sub-project bar
    const sel = this.projectPicker.activeSelection;
    if (sel) {
      const subProjectName = sel.subProjectName;
      const subPart = subProjectName ? ` / ${truncate(subProjectName, 28)}` : "";
      this.projectBarItem.text = `$(project) ${truncate(sel.projectName, 24)}${subPart}`;
      this.projectBarItem.tooltip = [
        `Project: ${sel.projectName}`,
        subProjectName ? `Sub-project: ${subProjectName}` : null,
        "",
        "Click to change project / sub-project",
      ].filter((x) => x !== null).join("\n");
      this.projectBarItem.backgroundColor = undefined;
    } else {
      this.projectBarItem.text = "$(project) Select Project";
      this.projectBarItem.tooltip = "Click to select which project you are working on";
      this.projectBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    }
    this.projectBarItem.show();

    this.refreshTrackerBar();
  }

  private refreshTrackerBar(): void {
    if (!this.hourlyBillingTracker) {
      this.trackerBarItem.hide();
      return;
    }
    const status = this.hourlyBillingTracker.status;
    if (!status || !status.is_hourly) {
      this.trackerBarItem.hide();
      return;
    }

    const used = (status.weekly_hours_used ?? 0).toFixed(1);
    const limit = status.weekly_hour_limit ?? 0;
    const spendStr =
      typeof status.weekly_spend_estimate === "number"
        ? `$${status.weekly_spend_estimate.toFixed(2)}`
        : "";

    if (status.suspended || status.billing_status === "SUSPENDED") {
      this.trackerBarItem.text = "$(warning) Tracker SUSPENDED";
      this.trackerBarItem.tooltip = "Hourly billing is suspended (payment failed). Tracking will resume once payment is restored.";
      this.trackerBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    } else if (status.limit_reached) {
      this.trackerBarItem.text = `$(warning) Limit reached ${used}/${limit}h`;
      this.trackerBarItem.tooltip = "Weekly hour limit reached. Tracking will resume next week.";
      this.trackerBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else if (this.hourlyBillingTracker.isTracking) {
      this.trackerBarItem.text = `$(record) Tracking ${used}/${limit}h${spendStr ? ` · ${spendStr}` : ""}`;
      this.trackerBarItem.tooltip = `Hourly tracker active\nThis week: ${used} / ${limit} hrs${spendStr ? `\nEstimate: ${spendStr}` : ""}`;
      this.trackerBarItem.backgroundColor = undefined;
    } else {
      this.trackerBarItem.text = `$(circle-outline) Tracker idle ${used}/${limit}h`;
      this.trackerBarItem.tooltip = "Hourly tracker is idle (between slots)";
      this.trackerBarItem.backgroundColor = undefined;
    }
    this.trackerBarItem.show();
  }

  dispose(): void {
    clearInterval(this.updateInterval);
    this.statusBarItem.dispose();
    this.projectBarItem.dispose();
    this.trackerBarItem.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
}
