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
  private _isScreenLocked = false;
  private appUsage = new Map<string, number>(); // appName → seconds
  private lastPollTime = Date.now();

  /** Start polling OS idle time and active window every 5 seconds */
  start(): void {
    if (this.pollInterval) return;
    this.lastPollTime = Date.now();
    this.pollInterval = setInterval(() => this.poll(), 5000);
    this.poll(); // immediate first poll
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

  /**
   * True when the OS reports the screen is locked (Windows lock screen,
   * Mac screen lock, Linux screensaver active). Updated on each 5-second
   * poll, so this can lag the actual lock event by up to 5s — fine for the
   * "don't take a screenshot of the lock screen" use case but don't rely
   * on it for instantaneous decisions.
   *
   * Conservative on platforms where detection isn't implemented: returns
   * `false` (assume unlocked) so we don't accidentally stop counting
   * legitimate work on unsupported platforms.
   */
  get isScreenLocked(): boolean {
    return this._isScreenLocked;
  }

  /** Harvest app usage map and reset. Returns { appName: seconds } */
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
      const [idleMs, windowInfo, locked] = await Promise.all([
        this.getOsIdleTime(),
        this.getActiveWindow(),
        this.getIsScreenLocked(),
      ]);

      this._osIdleSeconds = Math.round(idleMs / 1000);
      this._isScreenLocked = locked;
      if (windowInfo) {
        this._activeWindow = windowInfo;
        // Accumulate app usage only when not idle (< 60s OS idle) AND not
        // locked (no point bucketing seconds to LogonUI / lock-screen apps).
        if (this._osIdleSeconds < 60 && !locked) {
          const prev = this.appUsage.get(windowInfo.appName) || 0;
          this.appUsage.set(windowInfo.appName, prev + elapsedSec);
        }
      }
    } catch {
      // Non-critical — silently ignore
    }
  }

  /**
   * Detect screen-locked state. Conservative on platforms where detection
   * isn't reliable — returns false (assume unlocked) rather than
   * accidentally pausing tracking on a working machine.
   *
   * Windows: LogonUI.exe is the foreground process when the lock screen
   * is showing. Fast — just one Get-Process call, no API gymnastics.
   *
   * Mac: ioreg's IOConsoleUsers entry has a "CGSSessionScreenIsLocked"
   * key when the screen is locked. Already use ioreg for idle time so
   * the binary is hot in the cache.
   *
   * Linux: relies on the GNOME / freedesktop ScreenSaver D-Bus interface.
   * Many desktop environments (KDE, XFCE) implement this too. If the
   * call fails (no D-Bus, headless, weird WM), fall through to false.
   */
  private async getIsScreenLocked(): Promise<boolean> {
    const platform = os.platform();
    try {
      if (platform === "win32") {
        // Get-Process is cheap; LogonUI only exists when the secure desktop
        // is showing (lock screen, UAC prompt, Ctrl-Alt-Del). UAC prompts are
        // brief — false positives last a few seconds at most.
        const { stdout } = await execFileAsync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command",
            "if (Get-Process LogonUI -ErrorAction SilentlyContinue) { 'locked' } else { 'unlocked' }"],
          { timeout: 5000 },
        );
        return stdout.trim() === "locked";
      } else if (platform === "darwin") {
        const { stdout } = await execFileAsync(
          "ioreg",
          ["-n", "Root", "-d1", "-a"],
          { timeout: 5000 },
        );
        // The plist contains "CGSSessionScreenIsLocked" = 1 when locked.
        // Cheap substring check is good enough — full plist parsing is overkill.
        return /CGSSessionScreenIsLocked[^<]*<true|CGSSessionScreenIsLocked["']?\s*=\s*1/.test(stdout);
      } else {
        // Linux — query gnome-screensaver / freedesktop ScreenSaver via dbus.
        // Returns "true" / "false" string on success. Fails silently on
        // headless or non-Gnome/KDE environments.
        const { stdout } = await execFileAsync(
          "dbus-send",
          ["--session", "--print-reply", "--dest=org.gnome.ScreenSaver",
           "/org/gnome/ScreenSaver", "org.gnome.ScreenSaver.GetActive"],
          { timeout: 5000 },
        );
        return /boolean\s+true/.test(stdout);
      }
    } catch {
      // Detection failure → conservative default (don't pause tracking)
      return false;
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
        return match ? Math.round(parseInt(match[1], 10) / 1000000) : 0; // nanoseconds to ms
      } else {
        // Linux — try xprintidle
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
        // Linux — xdotool
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
