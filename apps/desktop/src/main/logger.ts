import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Tiny file-based logger so packaged builds leave a paper trail. Without it,
 * issues only surface if the user happens to launch the binary from a terminal.
 *
 * Log file location:
 *   Windows: %APPDATA%\Ailancers Tracker\logs\main.log
 *   macOS:   ~/Library/Application Support/Ailancers Tracker/logs/main.log
 *   Linux:   ~/.config/Ailancers Tracker/logs/main.log
 *
 * Each line: ISO timestamp + level + message. Rotates at 5 MB to avoid disk fill.
 */

const MAX_BYTES = 5 * 1024 * 1024;
let logPath: string | null = null;
let initialized = false;

function init() {
  if (initialized) return;
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, "main.log");
    initialized = true;
  } catch {
    initialized = true; // give up; only console will work
  }
}

function rotateIfNeeded() {
  if (!logPath) return;
  try {
    const stat = fs.statSync(logPath);
    if (stat.size > MAX_BYTES) {
      fs.renameSync(logPath, logPath + ".old");
    }
  } catch {
    // file doesn't exist yet — nothing to rotate
  }
}

function write(level: "INFO" | "WARN" | "ERROR", msg: string) {
  init();
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
  if (logPath) {
    try {
      rotateIfNeeded();
      fs.appendFileSync(logPath, line);
    } catch {
      // Disk full or permissions — just fall through to console
    }
  }
  // Also send to stdout so users running from a terminal see it live
  if (level === "ERROR") console.error(line.trimEnd());
  else if (level === "WARN") console.warn(line.trimEnd());
  else console.log(line.trimEnd());
}

export const log = {
  info(msg: string) { write("INFO", msg); },
  warn(msg: string) { write("WARN", msg); },
  error(msg: string) { write("ERROR", msg); },
  /** Returns the on-disk path so we can show it in the tray menu / logs. */
  filePath(): string | null {
    init();
    return logPath;
  },
};
