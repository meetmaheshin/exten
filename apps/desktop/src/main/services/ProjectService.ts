import type { AuthService } from "./AuthService";

const PLATFORM_URL = "https://staging-backend.ailancers.com";

export interface PlatformProject {
  id: string;
  project_code: string;
  title: string;
  total_budget: number;
  status: string;
  sub_project_count: number;
}

export interface PlatformSubProject {
  id: string;
  project_id: string;
  title: string;
  budget: number;
  priority: string;
}

export interface ActiveSelection {
  projectId: string;
  projectName: string;
  subProjectId: string | null;
  subProjectName: string | null;
}

export class ProjectService {
  private projects: PlatformProject[] = [];
  private _activeSelection: ActiveSelection | null = null;
  private cacheTime = 0;
  private cacheTTL = 5 * 60 * 1000;

  constructor(private authService: AuthService) {}

  get activeSelection(): ActiveSelection | null {
    return this._activeSelection;
  }

  get activeProjectId(): string | null {
    return this._activeSelection?.projectId ?? null;
  }

  get activeSubProjectId(): string | null {
    return this._activeSelection?.subProjectId ?? null;
  }

  async fetchProjects(): Promise<PlatformProject[]> {
    if (Date.now() - this.cacheTime < this.cacheTTL && this.projects.length > 0) {
      console.log(`[ProjectService] Returning ${this.projects.length} cached projects`);
      return this.projects;
    }

    const token = this.authService.getAccessToken();
    if (!token) {
      console.log("[ProjectService] No token available");
      return [];
    }

    console.log(`[ProjectService] Fetching from ${PLATFORM_URL}/api/v2/projects, token starts: ${token.slice(0, 20)}...`);

    try {
      const resp = await fetch(`${PLATFORM_URL}/api/v2/projects?page_size=100&member_only=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      console.log(`[ProjectService] Response status: ${resp.status}`);

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        console.error(`[ProjectService] Failed: ${resp.status} ${body.slice(0, 200)}`);
        return [];
      }

      const data = await resp.json() as { items: PlatformProject[] };
      this.projects = data.items || [];
      this.cacheTime = Date.now();
      console.log(`[ProjectService] Got ${this.projects.length} projects`);
      return this.projects;
    } catch (err) {
      console.error("[ProjectService] Fetch error:", err);
      return [];
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

  setSelection(selection: ActiveSelection | null): void {
    this._activeSelection = selection;
    console.log(`[ProjectService] Selection: ${selection ? `${selection.projectName} / ${selection.subProjectName}` : "cleared"}`);
  }

  invalidateCache(): void {
    this.cacheTime = 0;
    this.projects = [];
  }

  dispose(): void {
    this.projects = [];
  }
}
