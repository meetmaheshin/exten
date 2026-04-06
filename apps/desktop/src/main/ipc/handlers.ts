import { ipcMain } from "electron";
import type { AuthService } from "../services/AuthService";
import type { ProjectService } from "../services/ProjectService";
import type { ConfigStore } from "../services/ConfigStore";

export function registerIpcHandlers(
  authService: AuthService,
  projectService: ProjectService,
  configStore: ConfigStore
): void {
  // ─── Auth ───
  ipcMain.handle("auth:login", async (_event, email: string, password: string) => {
    try {
      const user = await authService.login(email, password);
      return { ok: true, user };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("auth:logout", () => {
    authService.logout();
    return { ok: true };
  });

  ipcMain.handle("auth:user", () => {
    return authService.getUser();
  });

  // ─── Projects ───
  ipcMain.handle("projects:list", async () => {
    try {
      const projects = await projectService.fetchProjects();
      return { ok: true, data: projects };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("projects:select", (_event, projectId: number, projectName: string, taskId: number | null, taskName: string | null) => {
    projectService.setSelection({ projectId, projectName, taskId, taskName });
    return { ok: true };
  });

  ipcMain.handle("projects:clear", () => {
    projectService.setSelection(null);
    return { ok: true };
  });

  ipcMain.handle("projects:active", () => {
    return projectService.activeSelection;
  });

  // ─── Config ───
  ipcMain.handle("config:get", () => {
    return configStore.getAll();
  });

  ipcMain.handle("config:set", (_event, key: string, value: unknown) => {
    configStore.set(key as keyof ReturnType<typeof configStore.getAll>, value as never);
    return { ok: true };
  });
}
