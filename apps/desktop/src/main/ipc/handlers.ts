import { ipcMain, shell } from "electron";
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

  ipcMain.handle("auth:loginWithBrowser", async () => {
    const serverUrl = configStore.get("serverUrl");
    try {
      // Step 1: Get a device code from our server
      const codeResp = await fetch(`${serverUrl}/api/auth/device-code`, { method: "POST" });
      if (!codeResp.ok) return { ok: false, error: "Failed to get login code" };
      const { code } = await codeResp.json() as { code: string };

      // Step 2: Open browser to auth bridge page
      shell.openExternal(`${serverUrl}/auth-bridge?code=${code}`);

      // Step 3: Poll for completion (every 2 seconds, max 5 minutes)
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollResp = await fetch(`${serverUrl}/api/auth/device-code/poll?code=${code}`);
        if (!pollResp.ok) continue;
        const poll = await pollResp.json() as { status: string; accessToken?: string; user?: unknown };
        if (poll.status === "complete" && poll.accessToken) {
          // Login with the received token
          await authService.loginWithToken(poll.accessToken, poll.user as { name: string });
          return { ok: true };
        }
        if (poll.status === "expired") {
          return { ok: false, error: "Login expired. Please try again." };
        }
      }
      return { ok: false, error: "Login timed out" };
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
