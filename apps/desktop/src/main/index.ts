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
import { UpdateCheckService } from "./services/UpdateCheckService";
import { TrayManager } from "./tray";
import { registerIpcHandlers } from "./ipc/handlers";
import { log } from "./logger";

// Prevent multiple instances. Use app.exit(0) instead of app.quit() — quit()
// is intercepted by our "window-all-closed" handler below (which deliberately
// keeps the app alive as a tray app), so a second-instance launch would NOT
// actually exit, leaving the user with multiple zombie processes that look
// like they're running but never reach app.whenReady().
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.exit(0);
}

// Keep app running when all windows are closed (tray app)
app.on("window-all-closed", () => {
  // Do nothing — keep the tray app running
});

app.whenReady().then(async () => {
  log.info(`[Ailancers] Desktop tracker starting... (logs: ${log.filePath() ?? "console only"})`);

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

  // ─── Update check (polls /api/version, surfaces "Update available" in tray) ───
  const updateCheck = new UpdateCheckService(apiClient);

  // ─── Create tray ───
  const trayManager = new TrayManager(authService, projectService, activityTracker, telemetryService, configStore, updateCheck);

  // Trigger the first version check + 6h poll. Tray listens for state changes
  // via the onChange hook below.
  updateCheck.onChange(() => trayManager.rebuildMenu());
  updateCheck.start();

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
      projectService.activeSubProjectId,
      projectService.activeSelection?.projectName ?? null,
      projectService.activeSelection?.subProjectName ?? null
    );
  }, 5000);

  // ─── Midnight session reset ───
  function scheduleMidnightReset(): void {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    setTimeout(async () => {
      log.info("[Ailancers] Midnight — resetting session for new day");
      await telemetryService.endSession();
      trayManager.resetActiveTime();
      await telemetryService.startSession();
      trayManager.rebuildMenu();
      // Schedule next midnight
      scheduleMidnightReset();
    }, msUntilMidnight);

    log.info(`[Ailancers] Midnight reset scheduled in ${Math.round(msUntilMidnight / 60000)}m`);
  }

  // ─── Start/stop services based on auth state ───
  let trackingStarted = false;
  async function startTracking(): Promise<void> {
    if (trackingStarted) {
      log.info("[Ailancers] startTracking called twice — ignoring second call");
      return;
    }
    trackingStarted = true;
    log.info("[Ailancers] User authenticated — starting tracking");

    // Check if VS Code extension already has an active session
    try {
      const checkResp = await apiClient.get<{ hasActiveSession: boolean }>("/api/telemetry/active-session?source=Code");
      if (checkResp.hasActiveSession) {
        log.info("[Ailancers] VS Code extension is already tracking — desktop tracker will skip tracking");
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
        log.info(`[Ailancers] Restored today's active time: ${Math.round(todaySeconds / 60)}m`);
      }
    } catch {
      // Non-critical
    }

    // Fetch projects and auto-select if previously saved
    try {
      const projects = await projectService.fetchProjects();
      log.info(`[Ailancers] ${projects.length} projects loaded`);

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
    log.info("[Ailancers] User logged out — stopping tracking");
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
    log.info("[Ailancers] No saved session — showing login");
    trayManager.showLoginWindow();
  }

  // ─── Auto-start on boot ───
  if (configStore.get("autoStartEnabled")) {
    if (process.platform === "linux") {
      // setLoginItemSettings is a no-op on Linux. Drop a .desktop file in
      // ~/.config/autostart/ instead — that's how XDG-spec desktops (GNOME,
      // KDE, Cinnamon, XFCE, etc.) launch user apps at login.
      try {
        const os = await import("node:os");
        const fs = await import("node:fs");
        const pathMod = await import("node:path");
        const autostartDir = pathMod.join(os.homedir(), ".config", "autostart");
        fs.mkdirSync(autostartDir, { recursive: true });
        const exe = process.execPath;
        const desktopFile = pathMod.join(autostartDir, "ailancers-tracker.desktop");
        const content = [
          "[Desktop Entry]",
          "Type=Application",
          "Name=Ailancers Tracker",
          `Exec=${exe}`,
          "X-GNOME-Autostart-enabled=true",
          "Hidden=false",
          "NoDisplay=false",
          "",
        ].join("\n");
        fs.writeFileSync(desktopFile, content, "utf-8");
        log.info(`[Ailancers] Linux autostart entry written: ${desktopFile}`);
      } catch (err) {
        log.error(`[Ailancers] Failed to set Linux autostart: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: true,
      });
    }
  }

  // ─── Handle quit gracefully ───
  app.on("before-quit", async () => {
    await telemetryService.endSession();
    screenCapture.stop();
    activityTracker.stop();
    systemIdle.stop();
    trayManager.dispose();
  });

  log.info("[Ailancers] Desktop tracker ready");
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
