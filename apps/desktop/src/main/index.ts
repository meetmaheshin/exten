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
  const screenCapture = new ScreenCaptureService(apiClient, activityTracker, configStore, telemetryService);
  const projectService = new ProjectService(authService);

  // Use Electron's built-in idle detection (more reliable than PowerShell)
  systemIdle.setElectronIdleProvider(() => powerMonitor.getSystemIdleTime());

  // ─── Register IPC handlers for renderer windows ───
  registerIpcHandlers(authService, projectService, configStore);

  // ─── Create tray ───
  const trayManager = new TrayManager(authService, projectService, activityTracker, telemetryService);

  // ─── Update tray timer on each heartbeat flush ───
  telemetryService.onFlush((result) => {
    trayManager.updateActiveTime(result.activeSeconds);
    trayManager.rebuildMenu();
  });

  // ─── Sync project selection → telemetry when user picks via tray ───
  // Poll project selection every 5s to keep telemetry in sync
  setInterval(() => {
    telemetryService.setActiveProject(
      projectService.activeProjectId,
      projectService.activeSubProjectId
    );
  }, 5000);

  // ─── Midnight session reset ───
  function scheduleMidnightReset(): void {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    setTimeout(async () => {
      console.log("[Ailancers] Midnight — resetting session for new day");
      await telemetryService.endSession();
      trayManager.resetActiveTime();
      await telemetryService.startSession();
      trayManager.rebuildMenu();
      // Schedule next midnight
      scheduleMidnightReset();
    }, msUntilMidnight);

    console.log(`[Ailancers] Midnight reset scheduled in ${Math.round(msUntilMidnight / 60000)}m`);
  }

  // ─── Start/stop services based on auth state ───
  let trackingStarted = false;
  async function startTracking(): Promise<void> {
    if (trackingStarted) {
      console.log("[Ailancers] startTracking called twice — ignoring second call");
      return;
    }
    trackingStarted = true;
    console.log("[Ailancers] User authenticated — starting tracking");

    // Check if VS Code extension already has an active session
    try {
      const checkResp = await apiClient.get<{ hasActiveSession: boolean }>("/api/telemetry/active-session?source=Code");
      if (checkResp.hasActiveSession) {
        console.log("[Ailancers] VS Code extension is already tracking — desktop tracker will skip tracking");
        const { Notification: ElectronNotification } = await import("electron");
        new ElectronNotification({
          title: "Ailancers Tracker",
          body: "VS Code extension is already tracking your activity. Desktop tracker is paused to avoid duplicate time.",
        }).show();
        trayManager.rebuildMenu();
        // Still fetch projects and restore time, just don't start a new session
        try {
          const todaySeconds = await telemetryService.fetchTodayActiveSeconds();
          if (todaySeconds > 0) trayManager.setTotalActiveSeconds(todaySeconds);
        } catch {}
        return;
      }
    } catch {
      // Can't check — proceed with tracking
    }

    systemIdle.start();
    activityTracker.start();
    await telemetryService.startSession();
    screenCapture.start();
    scheduleMidnightReset();

    // Restore today's active time so tray doesn't show 0m after re-login
    try {
      const todaySeconds = await telemetryService.fetchTodayActiveSeconds();
      if (todaySeconds > 0) {
        trayManager.setTotalActiveSeconds(todaySeconds);
        console.log(`[Ailancers] Restored today's active time: ${Math.round(todaySeconds / 60)}m`);
      }
    } catch {
      // Non-critical
    }

    // Fetch projects and auto-select if previously saved
    try {
      const projects = await projectService.fetchProjects();
      console.log(`[Ailancers] ${projects.length} projects loaded`);

      // Sync initial project selection to telemetry
      telemetryService.setActiveProject(
        projectService.activeProjectId,
        projectService.activeSubProjectId
      );
    } catch {
      // Non-critical
    }

    trayManager.rebuildMenu();
  }

  function stopTracking(): void {
    console.log("[Ailancers] User logged out — stopping tracking");
    trackingStarted = false;
    screenCapture.stop();
    activityTracker.stop();
    systemIdle.stop();
    telemetryService.setActiveProject(null, null);
    projectService.invalidateCache();
    trayManager.resetActiveTime();
    trayManager.rebuildMenu();
  }

  authService.on("authenticated", async (isAuth: boolean) => {
    if (isAuth) {
      await startTracking();
      // After login, show project picker so user selects a project
      if (!projectService.activeSelection) {
        trayManager.showPickerWindow();
      }
    } else {
      stopTracking();
    }
  });

  // ─── Try to restore session ───
  const restored = await authService.tryRestoreSession();
  if (restored) {
    await startTracking();
    // Check for updates
    checkForUpdates(configStore);
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

const DESKTOP_VERSION = "0.1.0";

async function checkForUpdates(configStore: import("./services/ConfigStore").ConfigStore): Promise<void> {
  try {
    const serverUrl = configStore.get("serverUrl");
    const resp = await fetch(`${serverUrl}/api/version`);
    if (!resp.ok) return;
    const data = await resp.json() as { desktop: { version: string; downloadUrl: string } };
    if (data.desktop.version !== DESKTOP_VERSION) {
      const { Notification: ElectronNotification, shell } = await import("electron");
      const notif = new ElectronNotification({
        title: "Ailancers Tracker Update Available",
        body: `Version ${data.desktop.version} is available (you have ${DESKTOP_VERSION}). Click to download.`,
      });
      notif.on("click", () => shell.openExternal(data.desktop.downloadUrl));
      notif.show();
    }
  } catch {
    // Silent fail
  }
}
