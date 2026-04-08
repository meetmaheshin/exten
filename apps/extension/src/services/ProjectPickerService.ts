import * as vscode from "vscode";
import type { AuthService } from "./AuthService";

const PLATFORM_URL = "https://staging-backend.ailancers.com";

// ─── Types from v2 API ───

export interface PlatformProject {
  id: string;
  project_code: string;
  title: string;
  total_budget: number;
  currency: string;
  status: string;
  priority: string;
  sub_project_count: number;
}

export interface PlatformSubProject {
  id: string;              // ← THIS is the sub_project_id for billing
  project_id: string;
  title: string;
  budget: number;
  priority: string;
  assigned_to: string | null;
}

export interface ActiveSelection {
  projectId: string;
  projectName: string;
  subProjectId: string | null;   // ← billing ID
  subProjectName: string | null;
}

const STORAGE_KEY = "ailancers.activeSelection";
const CACHE_KEY = "ailancers.projectsCache";
const CACHE_TTL_MS = 5 * 60 * 1000;

export class ProjectPickerService implements vscode.Disposable {
  private _activeSelection: ActiveSelection | null = null;
  private _onDidChange = new vscode.EventEmitter<ActiveSelection | null>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private authService: AuthService,
    private context: vscode.ExtensionContext
  ) {
    this._activeSelection = context.globalState.get<ActiveSelection>(STORAGE_KEY) ?? null;
  }

  get activeSelection(): ActiveSelection | null {
    return this._activeSelection;
  }

  get activeProjectId(): string | null {
    return this._activeSelection?.projectId ?? null;
  }

  /** The sub_project_id used for billing */
  get activeSubProjectId(): string | null {
    return this._activeSelection?.subProjectId ?? null;
  }

  // ─── Fetch from v2 API ───

  async fetchProjects(): Promise<PlatformProject[]> {
    const cached = this.context.globalState.get<{ data: PlatformProject[]; at: number }>(CACHE_KEY);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.data;
    }

    const token = this.authService.getAccessToken();
    if (!token) return [];

    try {
      const resp = await fetch(`${PLATFORM_URL}/api/v2/projects?page_size=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        console.error(`[ProjectPicker] v2/projects failed: ${resp.status}`);
        return cached?.data ?? [];
      }
      const data = await resp.json() as { items: PlatformProject[] };
      const projects = data.items || [];
      await this.context.globalState.update(CACHE_KEY, { data: projects, at: Date.now() });
      return projects;
    } catch (err) {
      console.error("[ProjectPicker] Failed to fetch projects:", err);
      return cached?.data ?? [];
    }
  }

  async fetchSubProjects(projectId: string): Promise<PlatformSubProject[]> {
    const token = this.authService.getAccessToken();
    if (!token) return [];

    try {
      const resp = await fetch(`${PLATFORM_URL}/api/v2/projects/${projectId}/sub-projects?page_size=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return [];
      const data = await resp.json() as { items: PlatformSubProject[] };
      return data.items || [];
    } catch {
      return [];
    }
  }

  // ─── Picker UI ───

  async promptPicker(): Promise<void> {
    const projects = await this.fetchProjects();

    if (projects.length === 0) {
      vscode.window.showInformationMessage("No projects found on the Ailancers platform.");
      return;
    }

    // Step 1: Pick project
    const projectItems: vscode.QuickPickItem[] = [
      { label: "$(x) Clear selection", description: "Stop tracking project" },
      ...projects.map((p) => ({
        label: `$(project) ${p.title}`,
        description: `${p.project_code} · ${p.status} · $${p.total_budget}`,
        detail: `${p.sub_project_count} sub-project${p.sub_project_count !== 1 ? "s" : ""}`,
      })),
    ];

    const projectPick = await vscode.window.showQuickPick(projectItems, {
      title: "Ailancers — Select Project",
      placeHolder: "Which project are you working on?",
      matchOnDescription: true,
    });
    if (!projectPick) return;

    if (projectPick.label.startsWith("$(x)")) {
      await this.clearSelection();
      return;
    }

    const selectedProject = projects.find((p) => `$(project) ${p.title}` === projectPick.label);
    if (!selectedProject) return;

    // Step 2: Fetch and pick sub-project
    const subProjects = await fetchWithProgress(
      () => this.fetchSubProjects(selectedProject.id),
      "Loading sub-projects..."
    );

    let selectedSub: PlatformSubProject | null = null;

    if (subProjects.length > 0) {
      const subItems: vscode.QuickPickItem[] = [
        { label: "$(dash) Project level only", description: "No specific sub-project" },
        ...subProjects.map((sp) => ({
          label: `$(tasklist) ${sp.title}`,
          description: `${sp.priority} · $${sp.budget}`,
        })),
      ];

      const subPick = await vscode.window.showQuickPick(subItems, {
        title: `Ailancers — Sub-project in "${selectedProject.title}"`,
        placeHolder: "Which sub-project?",
        matchOnDescription: true,
      });
      if (!subPick) return;

      if (!subPick.label.startsWith("$(dash)")) {
        selectedSub = subProjects.find((sp) => `$(tasklist) ${sp.title}` === subPick.label) ?? null;
      }
    }

    await this.setSelection({
      projectId: selectedProject.id,
      projectName: selectedProject.title,
      subProjectId: selectedSub?.id ?? null,
      subProjectName: selectedSub?.title ?? null,
    });
  }

  // ─── Selection management ───

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

  invalidateCache(): void {
    this.context.globalState.update(CACHE_KEY, undefined);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

async function fetchWithProgress<T>(fn: () => Promise<T>, message: string): Promise<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: message },
    () => fn()
  );
}
