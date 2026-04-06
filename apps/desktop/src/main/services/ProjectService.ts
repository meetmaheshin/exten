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

export class ProjectService {
  private projects: ExternalProject[] = [];
  private _activeSelection: ActiveSelection | null = null;
  private cacheTime = 0;
  private cacheTTL = 5 * 60 * 1000;

  constructor(private apiClient: ApiClient) {}

  get activeSelection(): ActiveSelection | null {
    return this._activeSelection;
  }

  get activeProjectId(): number | null {
    return this._activeSelection?.projectId ?? null;
  }

  get activeTaskId(): number | null {
    return this._activeSelection?.taskId ?? null;
  }

  async fetchProjects(): Promise<ExternalProject[]> {
    if (Date.now() - this.cacheTime < this.cacheTTL && this.projects.length > 0) {
      return this.projects;
    }

    try {
      const resp = await this.apiClient.get<{
        data: ExternalProject[];
        mapped: boolean;
        needsIdentityConfirmation?: boolean;
        candidates?: Array<{ id: number; name: string }>;
      }>("/api/projects/mine");

      if (!resp.mapped) return [];

      this.projects = resp.data;
      this.cacheTime = Date.now();
      return this.projects;
    } catch {
      return this.projects;
    }
  }

  setSelection(selection: ActiveSelection | null): void {
    this._activeSelection = selection;
  }

  invalidateCache(): void {
    this.cacheTime = 0;
    this.projects = [];
  }

  dispose(): void {
    this.projects = [];
  }
}
