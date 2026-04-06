import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ailancers", {
  // Auth
  login: (email: string, password: string) => ipcRenderer.invoke("auth:login", email, password),
  logout: () => ipcRenderer.invoke("auth:logout"),
  getUser: () => ipcRenderer.invoke("auth:user"),

  // Projects
  getProjects: () => ipcRenderer.invoke("projects:list"),
  selectProject: (projectId: number, projectName: string, taskId: number | null, taskName: string | null) =>
    ipcRenderer.invoke("projects:select", projectId, projectName, taskId, taskName),
  clearProject: () => ipcRenderer.invoke("projects:clear"),
  getActiveSelection: () => ipcRenderer.invoke("projects:active"),

  // Config
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (key: string, value: unknown) => ipcRenderer.invoke("config:set", key, value),

  // Events from main
  onStatusUpdate: (cb: (data: unknown) => void) => {
    ipcRenderer.on("status:update", (_event, data) => cb(data));
  },
  onAuthChange: (cb: (authenticated: boolean) => void) => {
    ipcRenderer.on("auth:changed", (_event, authenticated) => cb(authenticated));
  },
});
