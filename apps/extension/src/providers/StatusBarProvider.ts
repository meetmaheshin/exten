import * as vscode from "vscode";
import type { AuthService } from "../services/AuthService";
import type { ActivityTracker } from "../services/ActivityTracker";
import type { ProjectPickerService } from "../services/ProjectPickerService";

export class StatusBarProvider implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private projectBarItem: vscode.StatusBarItem;
  private updateInterval: ReturnType<typeof setInterval>;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private authService: AuthService,
    private activityTracker: ActivityTracker,
    private projectPicker: ProjectPickerService
  ) {
    // Left side: time + AI requests
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = "ailancers.openChat";

    // Left side (next to it): active project/task
    this.projectBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.projectBarItem.command = "ailancers.selectProject";

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

    // Project/task bar
    const sel = this.projectPicker.activeSelection;
    if (sel) {
      const taskPart = sel.taskName ? ` / ${truncate(sel.taskName, 28)}` : "";
      this.projectBarItem.text = `$(project) ${truncate(sel.projectName, 24)}${taskPart}`;
      this.projectBarItem.tooltip = [
        `Project: ${sel.projectName}`,
        sel.taskName ? `Task: ${sel.taskName}` : null,
        "",
        "Click to change project/task",
      ].filter((x) => x !== null).join("\n");
      this.projectBarItem.backgroundColor = undefined;
    } else {
      this.projectBarItem.text = "$(project) Select Project";
      this.projectBarItem.tooltip = "Click to select which project you are working on";
      this.projectBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    }
    this.projectBarItem.show();
  }

  dispose(): void {
    clearInterval(this.updateInterval);
    this.statusBarItem.dispose();
    this.projectBarItem.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
}
