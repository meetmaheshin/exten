import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Manages auto-starting VS Code on system boot.
 * - Windows: creates a .vbs script in shell:startup (opens VS Code minimized)
 * - macOS: creates a LaunchAgent plist
 * - Linux: creates a .desktop file in ~/.config/autostart
 */
export class AutoStartService {
  private static readonly AUTOSTART_KEY = "ailancers.autoStartEnabled";

  constructor(private context: vscode.ExtensionContext) {}

  /** Check if auto-start is currently enabled */
  isEnabled(): boolean {
    return this.context.globalState.get<boolean>(AutoStartService.AUTOSTART_KEY, false);
  }

  /** Enable auto-start — adds VS Code to OS startup */
  async enable(): Promise<void> {
    const platform = os.platform();
    try {
      if (platform === "win32") {
        await this.enableWindows();
      } else if (platform === "darwin") {
        await this.enableMac();
      } else {
        await this.enableLinux();
      }
      await this.context.globalState.update(AutoStartService.AUTOSTART_KEY, true);
    } catch (err) {
      throw new Error(`Failed to enable auto-start: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Disable auto-start — removes VS Code from OS startup */
  async disable(): Promise<void> {
    const platform = os.platform();
    try {
      if (platform === "win32") {
        await this.disableWindows();
      } else if (platform === "darwin") {
        await this.disableMac();
      } else {
        await this.disableLinux();
      }
      await this.context.globalState.update(AutoStartService.AUTOSTART_KEY, false);
    } catch {
      // Best effort — still update state
      await this.context.globalState.update(AutoStartService.AUTOSTART_KEY, false);
    }
  }

  /** Prompt user on first login to enable auto-start */
  async promptOnFirstLogin(): Promise<void> {
    const prompted = this.context.globalState.get<boolean>("ailancers.autoStartPrompted", false);
    if (prompted) return;

    await this.context.globalState.update("ailancers.autoStartPrompted", true);

    const choice = await vscode.window.showInformationMessage(
      "Would you like Ailancers to start automatically when you turn on your computer? (You can change this later in settings)",
      "Yes, auto-start",
      "No thanks"
    );

    if (choice === "Yes, auto-start") {
      try {
        await this.enable();
        vscode.window.showInformationMessage("Ailancers: Auto-start enabled. VS Code will open automatically on boot.");
      } catch (err) {
        vscode.window.showErrorMessage(`Ailancers: Could not enable auto-start — ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // ─── Windows ───
  private async enableWindows(): Promise<void> {
    // Create a VBS script that opens VS Code minimized
    const startupDir = path.join(os.homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
    const vbsPath = path.join(startupDir, "AilancersTracker.vbs");

    // Find VS Code executable
    const codePath = await this.findVsCodePath();

    const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${codePath}""", 7, False
`;
    // 7 = minimized and not active

    await fs.promises.mkdir(startupDir, { recursive: true });
    await fs.promises.writeFile(vbsPath, vbsContent, "utf-8");
  }

  private async disableWindows(): Promise<void> {
    const startupDir = path.join(os.homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
    const vbsPath = path.join(startupDir, "AilancersTracker.vbs");
    await fs.promises.unlink(vbsPath).catch(() => {});
  }

  // ─── macOS ───
  private async enableMac(): Promise<void> {
    const plistDir = path.join(os.homedir(), "Library", "LaunchAgents");
    const plistPath = path.join(plistDir, "com.ailancers.tracker.plist");

    const codePath = "/usr/local/bin/code";

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ailancers.tracker</string>
  <key>ProgramArguments</key>
  <array>
    <string>${codePath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>LaunchOnlyOnce</key>
  <true/>
</dict>
</plist>`;

    await fs.promises.mkdir(plistDir, { recursive: true });
    await fs.promises.writeFile(plistPath, plistContent, "utf-8");
  }

  private async disableMac(): Promise<void> {
    const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", "com.ailancers.tracker.plist");
    await fs.promises.unlink(plistPath).catch(() => {});
  }

  // ─── Linux ───
  private async enableLinux(): Promise<void> {
    const autostartDir = path.join(os.homedir(), ".config", "autostart");
    const desktopPath = path.join(autostartDir, "ailancers-tracker.desktop");

    const desktopContent = `[Desktop Entry]
Type=Application
Name=Ailancers Tracker
Exec=code
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
Comment=Start VS Code for Ailancers activity tracking
`;

    await fs.promises.mkdir(autostartDir, { recursive: true });
    await fs.promises.writeFile(desktopPath, desktopContent, "utf-8");
  }

  private async disableLinux(): Promise<void> {
    const desktopPath = path.join(os.homedir(), ".config", "autostart", "ailancers-tracker.desktop");
    await fs.promises.unlink(desktopPath).catch(() => {});
  }

  /** Find VS Code executable path */
  private async findVsCodePath(): Promise<string> {
    const platform = os.platform();

    if (platform === "win32") {
      // Common VS Code paths on Windows
      const candidates = [
        path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe"),
        path.join(process.env.PROGRAMFILES || "", "Microsoft VS Code", "Code.exe"),
        path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft VS Code", "Code.exe"),
      ];

      for (const candidate of candidates) {
        try {
          await fs.promises.access(candidate, fs.constants.F_OK);
          return candidate;
        } catch {
          continue;
        }
      }

      // Fallback — try "code" from PATH
      return "code";
    }

    return "code";
  }
}
