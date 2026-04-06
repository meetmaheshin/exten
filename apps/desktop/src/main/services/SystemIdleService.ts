import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ActiveWindowInfo {
  appName: string;
  title: string;
}

export class SystemIdleService {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private _osIdleSeconds = 0;
  private _activeWindow: ActiveWindowInfo = { appName: "unknown", title: "" };
  private appUsage = new Map<string, number>();
  private lastPollTime = Date.now();
  private useElectronIdle: (() => number) | null = null;

  /** Optionally inject Electron's powerMonitor.getSystemIdleTime */
  setElectronIdleProvider(fn: () => number): void {
    this.useElectronIdle = fn;
  }

  start(): void {
    if (this.pollInterval) return;
    this.lastPollTime = Date.now();
    this.pollInterval = setInterval(() => this.poll(), 5000);
    this.poll();
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  get osIdleSeconds(): number {
    return this._osIdleSeconds;
  }

  get activeWindow(): ActiveWindowInfo {
    return this._activeWindow;
  }

  harvestAppUsage(): Record<string, number> {
    const result = Object.fromEntries(this.appUsage);
    this.appUsage.clear();
    return result;
  }

  private async poll(): Promise<void> {
    const now = Date.now();
    const elapsedSec = Math.round((now - this.lastPollTime) / 1000);
    this.lastPollTime = now;

    try {
      // Use Electron's powerMonitor if available, else shell-out
      const idleSeconds = this.useElectronIdle
        ? this.useElectronIdle()
        : Math.round((await this.getOsIdleTime()) / 1000);

      this._osIdleSeconds = idleSeconds;

      const windowInfo = await this.getActiveWindow();
      if (windowInfo) {
        this._activeWindow = windowInfo;
        if (this._osIdleSeconds < 60) {
          const prev = this.appUsage.get(windowInfo.appName) || 0;
          this.appUsage.set(windowInfo.appName, prev + elapsedSec);
        }
      }
    } catch {
      // Non-critical
    }
  }

  private async getOsIdleTime(): Promise<number> {
    const platform = os.platform();
    try {
      if (platform === "win32") {
        const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class IdleTime {
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  public static int Get() {
    LASTINPUTINFO lii = new LASTINPUTINFO();
    lii.cbSize = (uint)Marshal.SizeOf(lii);
    GetLastInputInfo(ref lii);
    return Environment.TickCount - (int)lii.dwTime;
  }
}
'@
[IdleTime]::Get()`.trim();
        const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 5000 });
        return parseInt(stdout.trim(), 10) || 0;
      } else if (platform === "darwin") {
        const { stdout } = await execFileAsync("ioreg", ["-c", "IOHIDSystem"], { timeout: 5000 });
        const match = stdout.match(/"HIDIdleTime"\s*=\s*(\d+)/);
        return match ? Math.round(parseInt(match[1], 10) / 1000000) : 0;
      } else {
        const { stdout } = await execFileAsync("xprintidle", [], { timeout: 5000 });
        return parseInt(stdout.trim(), 10) || 0;
      }
    } catch {
      return 0;
    }
  }

  private async getActiveWindow(): Promise<ActiveWindowInfo | null> {
    const platform = os.platform();
    try {
      if (platform === "win32") {
        const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
public class ActiveWin {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  public static string Get() {
    IntPtr hwnd = GetForegroundWindow();
    StringBuilder title = new StringBuilder(256);
    GetWindowText(hwnd, title, 256);
    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    try {
      Process p = Process.GetProcessById((int)pid);
      return p.ProcessName + "|" + title.ToString();
    } catch { return "unknown|" + title.ToString(); }
  }
}
'@
[ActiveWin]::Get()`.trim();
        const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 5000 });
        const parts = stdout.trim().split("|");
        return { appName: parts[0] || "unknown", title: parts.slice(1).join("|") || "" };
      } else if (platform === "darwin") {
        const script = 'tell application "System Events" to get {name, title} of first application process whose frontmost is true';
        const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 5000 });
        const parts = stdout.trim().split(", ");
        return { appName: parts[0] || "unknown", title: parts[1] || "" };
      } else {
        const { stdout: nameStr } = await execFileAsync("xdotool", ["getactivewindow", "getwindowclassname"], { timeout: 5000 });
        const { stdout: titleStr } = await execFileAsync("xdotool", ["getactivewindow", "getwindowname"], { timeout: 5000 });
        return { appName: nameStr.trim() || "unknown", title: titleStr.trim() || "" };
      }
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.stop();
  }
}
