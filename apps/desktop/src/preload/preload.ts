import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ailancers", {
  // Auth
  login: (email: string, password: string) => ipcRenderer.invoke("auth:login", email, password),
  loginWithBrowser: () => ipcRenderer.invoke("auth:loginWithBrowser"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  getUser: () => ipcRenderer.invoke("auth:user"),

  // Projects
  getProjects: () => ipcRenderer.invoke("projects:list"),
  getSubProjects: (projectId: string) => ipcRenderer.invoke("projects:subprojects", projectId),
  selectProject: (projectId: string, projectName: string, subProjectId: string | null, subProjectName: string | null) =>
    ipcRenderer.invoke("projects:select", projectId, projectName, subProjectId, subProjectName),
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
