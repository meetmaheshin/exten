import * as vscode from "vscode";
import type { ApiClient } from "./ApiClient";

export interface ExternalTask {
  id: number;
  name: string;
  state: string | null;
  stageName: string | null;
  priority: string | null;
  dateDeadline: string | null;
}

export interface ExternalProject {
  id: number;
  name: string;
  stageName: string | null;
  ownerName: string | null;
  businessUnit: string | null;
  taskCount: number;
  dateEnd: string | null;
  myTasks: ExternalTask[];
}

export interface ActiveSelection {
  projectId: number;
  projectName: string;
  taskId: number | null;
  taskName: string | null;
}

export interface ExternalUserCandidate {
  id: number;
  name: string;
}

const STORAGE_KEY = "ailancers.activeSelection";
const CACHE_KEY = "ailancers.projectsCache";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class ProjectPickerService implements vscode.Disposable {
  private _activeSelection: ActiveSelection | null = null;
  private _onDidChange = new vscode.EventEmitter<ActiveSelection | null>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private apiClient: ApiClient,
    private context: vscode.ExtensionContext
  ) {
    // Restore persisted selection
    this._activeSelection = context.globalState.get<ActiveSelection>(STORAGE_KEY) ?? null;
  }

  get activeSelection(): ActiveSelection | null {
    return this._activeSelection;
  }

  get activeProjectId(): number | null {
    return this._activeSelection?.projectId ?? null;
  }

  get activeTaskId(): number | null {
    return this._activeSelection?.taskId ?? null;
  }

  /** Fetch projects assigned to the current user. Uses a short cache.
   *  Returns empty array if identity confirmation is needed (caller should call promptIdentityConfirmation). */
  async fetchMyProjects(): Promise<ExternalProject[]> {
    const cached = this.context.globalState.get<{ data: ExternalProject[]; at: number }>(CACHE_KEY);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const resp = await this.apiClient.get<{
        data: ExternalProject[];
        mapped: boolean;
        needsIdentityConfirmation?: boolean;
        candidates?: ExternalUserCandidate[];
      }>("/api/projects/mine");

      if (resp.needsIdentityConfirmation && resp.candidates?.length) {
        // Don't cache — ask user to confirm identity, then re-fetch
        await this.promptIdentityConfirmation(resp.candidates);
        return [];
      }

      if (!resp.mapped) return [];
      await this.context.globalState.update(CACHE_KEY, { data: resp.data, at: Date.now() });
      return resp.data;
    } catch {
      return cached?.data ?? [];
    }
  }

  /** When multiple platform users share the same name, ask which one they are. */
  async promptIdentityConfirmation(candidates: ExternalUserCandidate[]): Promise<void> {
    const items = candidates.map((c) => ({
      label: c.name,
      description: `Platform ID: ${c.id}`,
      candidate: c,
    }));

    const pick = await vscode.window.showQuickPick(items, {
      title: "Ailancers — Confirm Your Identity",
      placeHolder: `Multiple people named "${candidates[0].name}" found. Which one are you?`,
      ignoreFocusOut: true,
    });

    if (!pick) return; // user cancelled — will be asked again next time

    try {
      await this.apiClient.post("/api/projects/confirm-identity", {
        externalUserId: pick.candidate.id,
        externalUserName: pick.candidate.name,
      });
      // Invalidate cache so next fetch uses the confirmed mapping
      this.invalidateCache();
    } catch (err) {
      vscode.window.showErrorMessage("Failed to confirm identity: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  /** Show the QuickPick UI for choosing project → task. */
  async promptPicker(): Promise<void> {
    const projects = await this.fetchMyProjects();

    if (projects.length === 0) {
      vscode.window.showInformationMessage(
        "No projects assigned to you in the Ailancers platform. Ask your admin to sync and verify your account."
      );
      return;
    }

    // Step 1: Pick project
    const projectItems: vscode.QuickPickItem[] = [
      { label: "$(x) No project / Clear selection", description: "Stop tracking project time" },
      ...projects.map((p) => ({
        label: `$(project) ${p.name}`,
        description: [p.stageName, p.businessUnit].filter(Boolean).join(" · "),
        detail: p.myTasks.length > 0
          ? `${p.myTasks.length} task${p.myTasks.length !== 1 ? "s" : ""} assigned to you`
          : "No tasks assigned to you",
      })),
    ];

    const projectPick = await vscode.window.showQuickPick(projectItems, {
      title: "Ailancers — Select Active Project",
      placeHolder: "Which project are you working on?",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!projectPick) return; // cancelled

    if (projectPick.label.startsWith("$(x)")) {
      await this.clearSelection();
      return;
    }

    const selectedProject = projects.find(
      (p) => `$(project) ${p.name}` === projectPick.label
    );
    if (!selectedProject) return;

    // Step 2: Pick task (if there are tasks)
    let selectedTask: ExternalTask | null = null;
    if (selectedProject.myTasks.length > 0) {
      const taskItems: vscode.QuickPickItem[] = [
        { label: "$(dash) No specific task", description: "Track time at project level only" },
        ...selectedProject.myTasks.map((t) => ({
          label: `$(tasklist) ${t.name}`,
          description: [t.stageName, t.state ? stateLabel(t.state) : null].filter(Boolean).join(" · "),
          detail: t.dateDeadline
            ? `Deadline: ${new Date(t.dateDeadline).toLocaleDateString()}`
            : undefined,
        })),
      ];

      const taskPick = await vscode.window.showQuickPick(taskItems, {
        title: `Ailancers — Select Task in "${selectedProject.name}"`,
        placeHolder: "Which task are you working on?",
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!taskPick) return; // cancelled

      if (!taskPick.label.startsWith("$(dash)")) {
        selectedTask = selectedProject.myTasks.find(
          (t) => `$(tasklist) ${t.name}` === taskPick.label
        ) ?? null;
      }
    }

    await this.setSelection({
      projectId: selectedProject.id,
      projectName: selectedProject.name,
      taskId: selectedTask?.id ?? null,
      taskName: selectedTask?.name ?? null,
    });
  }

  async setSelection(selection: ActiveSelection): Promise<void> {
    this._activeSelection = selection;
    await this.context.globalState.update(STORAGE_KEY, selection);
    this._onDidChange.fire(selection);
  }

  async clearSelection(): Promise<void> {
    this._activeSelection = null;
    await this.context.globalState.update(STORAGE_KEY, undefined);
    this._onDidChange.fire(null);
  }

  /** Invalidate cache so next fetchMyProjects hits the API */
  invalidateCache(): void {
    this.context.globalState.update(CACHE_KEY, undefined);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

function stateLabel(state: string): string {
  const map: Record<string, string> = {
    "01_in_progress": "In Progress",
    "04_waiting_normal": "Waiting",
    "1_done": "Done",
    "03_cancelled": "Cancelled",
  };
  return map[state] ?? state;
}
