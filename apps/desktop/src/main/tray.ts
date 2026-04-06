import { Tray, Menu, nativeImage, BrowserWindow, app } from "electron";
import * as path from "node:path";
import type { AuthService } from "./services/AuthService";
import type { ProjectService } from "./services/ProjectService";
import type { ActivityTracker } from "./services/ActivityTracker";
import type { TelemetryService } from "./services/TelemetryService";

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export class TrayManager {
  private tray: Tray;
  private loginWindow: BrowserWindow | null = null;
  private pickerWindow: BrowserWindow | null = null;
  private totalActiveSeconds = 0;

  constructor(
    private authService: AuthService,
    private projectService: ProjectService,
    private activityTracker: ActivityTracker,
    private telemetryService: TelemetryService
  ) {
    // Create tray icon
    const iconPath = path.join(__dirname, "..", "..", "resources", "icon.png");
    let icon: Electron.NativeImage;
    try {
      icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    } catch {
      icon = nativeImage.createEmpty();
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip("Ailancers Tracker");
    this.rebuildMenu();

    // Rebuild menu every 30 seconds to update status
    setInterval(() => this.rebuildMenu(), 30_000);
  }

  rebuildMenu(): void {
    const isAuth = this.authService.isAuthenticated;
    const user = this.authService.getUser();
    const selection = this.projectService.activeSelection;
    const isIdle = this.activityTracker.isIdle;

    let statusLabel = "Not logged in";
    if (isAuth) {
      statusLabel = isIdle
        ? `Idle`
        : `Tracking (${formatTime(this.totalActiveSeconds)})`;
    }

    const projectLabel = selection
      ? `${selection.projectName}${selection.taskName ? ` > ${selection.taskName}` : ""}`
      : "No project selected";

    const template: Electron.MenuItemConstructorOptions[] = [
      { label: "Ailancers Tracker", type: "normal", enabled: false },
      { type: "separator" },
    ];

    if (isAuth) {
      template.push(
        { label: `${user?.name || "User"}`, type: "normal", enabled: false },
        { label: statusLabel, type: "normal", enabled: false },
        { label: projectLabel, type: "normal", enabled: false },
        { type: "separator" },
        { label: "Select Project/Task...", click: () => this.showPickerWindow() },
        { type: "separator" },
        { label: "Logout", click: () => this.handleLogout() }
      );
    } else {
      template.push(
        { label: "Login...", click: () => this.showLoginWindow() }
      );
    }

    template.push(
      { type: "separator" },
      { label: "Quit", click: () => this.handleQuit() }
    );

    const contextMenu = Menu.buildFromTemplate(template);
    this.tray.setContextMenu(contextMenu);
  }

  updateActiveTime(seconds: number): void {
    this.totalActiveSeconds += seconds;
  }

  setTotalActiveSeconds(seconds: number): void {
    this.totalActiveSeconds = seconds;
  }

  resetActiveTime(): void {
    this.totalActiveSeconds = 0;
  }

  showLoginWindow(): void {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.focus();
      return;
    }

    this.loginWindow = new BrowserWindow({
      width: 400,
      height: 350,
      resizable: false,
      title: "Ailancers — Login",
      webPreferences: {
        preload: path.join(__dirname, "..", "preload", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.loginWindow.loadFile(path.join(__dirname, "..", "renderer", "login", "index.html"));
    this.loginWindow.on("closed", () => { this.loginWindow = null; });
  }

  showPickerWindow(): void {
    if (this.pickerWindow && !this.pickerWindow.isDestroyed()) {
      this.pickerWindow.focus();
      return;
    }

    this.pickerWindow = new BrowserWindow({
      width: 450,
      height: 500,
      resizable: false,
      title: "Ailancers — Select Project",
      webPreferences: {
        preload: path.join(__dirname, "..", "preload", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.pickerWindow.loadFile(path.join(__dirname, "..", "renderer", "picker", "index.html"));
    this.pickerWindow.on("closed", () => { this.pickerWindow = null; });
  }

  closeWindows(): void {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) this.loginWindow.close();
    if (this.pickerWindow && !this.pickerWindow.isDestroyed()) this.pickerWindow.close();
  }

  private async handleLogout(): Promise<void> {
    await this.telemetryService.endSession();
    this.authService.logout();
    this.resetActiveTime();
    this.rebuildMenu();
  }

  private async handleQuit(): Promise<void> {
    await this.telemetryService.endSession();
    app.quit();
  }

  dispose(): void {
    this.closeWindows();
    this.tray.destroy();
  }
}
