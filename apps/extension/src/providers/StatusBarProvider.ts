import * as vscode from "vscode";
import type { AuthService } from "../services/AuthService";
import type { ActivityTracker } from "../services/ActivityTracker";

export class StatusBarProvider implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private updateInterval: ReturnType<typeof setInterval>;

  constructor(
    private authService: AuthService,
    private activityTracker: ActivityTracker
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = "ailancers.openChat";
    this.refresh();
    this.statusBarItem.show();

    this.updateInterval = setInterval(() => this.refresh(), 30_000);
  }

  refresh(): void {
    if (!this.authService.isAuthenticated) {
      this.statusBarItem.text = "$(comment-discussion) Ailancers: Sign In";
      this.statusBarItem.tooltip = "Click to sign in to Ailancers Code";
      this.statusBarItem.command = "ailancers.login";
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
  }

  dispose(): void {
    clearInterval(this.updateInterval);
    this.statusBarItem.dispose();
  }
}
