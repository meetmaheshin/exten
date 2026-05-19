import * as vscode from "vscode";
import type { AuthService } from "../services/AuthService";
import type { ActivityTracker } from "../services/ActivityTracker";
import type { ProjectPickerService } from "../services/ProjectPickerService";

export class StatusBarProvider implements vscode.Disposable {
  private signInItem: vscode.StatusBarItem;
  private statusBarItem: vscode.StatusBarItem;
  private projectBarItem: vscode.StatusBarItem;
  private attentionItem: vscode.StatusBarItem;
  private attentionState: "none" | "pending" | "done" = "none";
  /** True while an agent stream is actively running. Takes priority over
   *  attentionState — we surface a `$(sync~spin) running…` spinner so the
   *  user always knows there's a long-running operation in flight, even if
   *  they switched away from the chat view. */
  private streaming = false;
  private streamingStartedAt = 0;
  private updateInterval: ReturnType<typeof setInterval>;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private authService: AuthService,
    private activityTracker: ActivityTracker,
    private projectPicker: ProjectPickerService,
  ) {
    // Highest priority: a hard-to-miss yellow Sign in button shown only when
    // not authenticated. Separate from statusBarItem so its presence is the
    // discoverability cue, not just a label change on a single item.
    this.signInItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
    this.signInItem.text = "$(sign-in) Sign in to Ailancers";
    this.signInItem.tooltip = "Click to open the Ailancers sidebar and sign in";
    this.signInItem.command = "ailancers.login";
    this.signInItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");

    // Left side: time + AI requests
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = "ailancers.openChat";

    // Left side (next to it): active project/task
    this.projectBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.projectBarItem.command = "ailancers.selectProject";

    // Attention indicator — shown only when the chat is hidden AND something
    // needs the user (permission pending or stream completed). Click → open chat.
    this.attentionItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
    this.attentionItem.command = "ailancers.openChat";

    this.refresh();

    this.updateInterval = setInterval(() => this.refresh(), 30_000);

    // Immediately refresh when project selection changes
    this.disposables.push(
      projectPicker.onDidChange(() => this.refresh())
    );
  }

  /**
   * Mark the attention state. Called by ChatViewProvider when the chat is
   * hidden and (a) approval is needed, or (b) a stream just finished. Cleared
   * to "none" when the chat is brought back into view.
   */
  setAttention(state: "none" | "pending" | "done"): void {
    this.attentionState = state;
    this.refreshAttention();
  }

  /** Toggle the streaming spinner. Called by ChatViewProvider when an
   *  agent run starts / ends. Reuses the same status-bar item so we don't
   *  pile on slots — streaming wins over attention while it's true. */
  /** 1s ticker that updates the elapsed counter on the streaming indicator.
   *  Only active while streaming so we don't burn battery on idle status. */
  private streamingTicker: NodeJS.Timeout | null = null;

  setStreaming(streaming: boolean): void {
    this.streaming = streaming;
    if (streaming) {
      this.streamingStartedAt = Date.now();
      if (!this.streamingTicker) {
        this.streamingTicker = setInterval(() => this.refreshAttention(), 1000);
      }
    } else if (this.streamingTicker) {
      clearInterval(this.streamingTicker);
      this.streamingTicker = null;
    }
    this.refreshAttention();
  }

  private refreshAttention(): void {
    if (!this.authService.isAuthenticated) {
      this.attentionItem.hide();
      return;
    }
    if (this.streaming) {
      const elapsed = Math.max(0, Math.floor((Date.now() - this.streamingStartedAt) / 1000));
      this.attentionItem.text = `$(sync~spin) Ailancers running… ${elapsed}s`;
      this.attentionItem.tooltip = "An agent run is in progress. Click to open the chat.";
      this.attentionItem.backgroundColor = undefined;
      this.attentionItem.show();
      return;
    }
    if (this.attentionState === "none") {
      this.attentionItem.hide();
      return;
    }
    if (this.attentionState === "pending") {
      this.attentionItem.text = "$(bell) Ailancers needs you";
      this.attentionItem.tooltip = "Ailancers is waiting on permission. Click to open the chat.";
      this.attentionItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else {
      this.attentionItem.text = "$(check) Ailancers finished";
      this.attentionItem.tooltip = "Ailancers finished while the chat was hidden. Click to open it.";
      this.attentionItem.backgroundColor = undefined;
    }
    this.attentionItem.show();
  }

  refresh(): void {
    if (!this.authService.isAuthenticated) {
      // Show the yellow Sign in pill, hide everything else
      this.signInItem.show();
      this.statusBarItem.hide();
      this.projectBarItem.hide();
      this.attentionItem.hide();
      return;
    }
    // Authenticated — hide the Sign in pill, show the regular status items
    this.signInItem.hide();
    this.statusBarItem.show();
    this.refreshAttention();

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
  }

  dispose(): void {
    clearInterval(this.updateInterval);
    if (this.streamingTicker) clearInterval(this.streamingTicker);
    this.signInItem.dispose();
    this.statusBarItem.dispose();
    this.projectBarItem.dispose();
    this.attentionItem.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
}
