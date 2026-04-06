import { app, powerMonitor } from "electron";
import { ConfigStore } from "./services/ConfigStore";
import { SecureStore } from "./services/SecureStore";
import { AuthService } from "./services/AuthService";
import { ApiClient } from "./services/ApiClient";
import { SystemIdleService } from "./services/SystemIdleService";
import { ActivityTracker } from "./services/ActivityTracker";
import { TelemetryService } from "./services/TelemetryService";
import { ScreenCaptureService } from "./services/ScreenCaptureService";
import { ProjectService } from "./services/ProjectService";
import { TrayManager } from "./tray";
import { registerIpcHandlers } from "./ipc/handlers";

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Keep app running when all windows are closed (tray app)
app.on("window-all-closed", () => {
  // Do nothing — keep the tray app running
});

app.whenReady().then(async () => {
  console.log("[Ailancers] Desktop tracker starting...");

  // ─── Initialize services ───
  const configStore = new ConfigStore();
  const secureStore = new SecureStore();
  const authService = new AuthService(secureStore, configStore);
  const apiClient = new ApiClient(authService);
  const systemIdle = new SystemIdleService();
  const activityTracker = new ActivityTracker(systemIdle, configStore);
  const telemetryService = new TelemetryService(apiClient, activityTracker, configStore);
  const screenCapture = new ScreenCaptureService(apiClient, activityTracker, configStore);
  const projectService = new ProjectService(apiClient);

  // Use Electron's built-in idle detection (more reliable than PowerShell)
  systemIdle.setElectronIdleProvider(() => powerMonitor.getSystemIdleTime());

  // ─── Register IPC handlers for renderer windows ───
  registerIpcHandlers(authService, projectService, configStore);

  // ─── Create tray ───
  const trayManager = new TrayManager(authService, projectService, activityTracker, telemetryService);

  // ─── Start/stop services based on auth state ───
  async function startTracking(): Promise<void> {
    console.log("[Ailancers] User authenticated — starting tracking");
    systemIdle.start();
    activityTracker.start();
    await telemetryService.startSession();
    screenCapture.start();

    // Fetch projects in background
    try {
      const projects = await projectService.fetchProjects();
      console.log(`[Ailancers] ${projects.length} projects loaded`);
    } catch {
      // Non-critical
    }

    trayManager.rebuildMenu();
  }

  function stopTracking(): void {
    console.log("[Ailancers] User logged out — stopping tracking");
    screenCapture.stop();
    activityTracker.stop();
    systemIdle.stop();
    projectService.invalidateCache();
    trayManager.resetActiveTime();
    trayManager.rebuildMenu();
  }

  authService.on("authenticated", async (isAuth: boolean) => {
    if (isAuth) {
      await startTracking();
    } else {
      stopTracking();
    }
  });

  // ─── Try to restore session ───
  const restored = await authService.tryRestoreSession();
  if (restored) {
    await startTracking();
  } else {
    console.log("[Ailancers] No saved session — showing login");
    trayManager.showLoginWindow();
  }

  // ─── Auto-start on boot ───
  if (configStore.get("autoStartEnabled")) {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
    });
  }

  // ─── Handle quit gracefully ───
  app.on("before-quit", async () => {
    await telemetryService.endSession();
    screenCapture.stop();
    activityTracker.stop();
    systemIdle.stop();
    trayManager.dispose();
  });

  console.log("[Ailancers] Desktop tracker ready");
});
