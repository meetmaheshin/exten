import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";

export interface DesktopConfig {
  serverUrl: string;
  trackingEnabled: boolean;
  idleTimeoutSeconds: number;
  telemetryIntervalSeconds: number;
  screenCaptureEnabled: boolean;
  screenCaptureIntervalSeconds: number;
  autoStartEnabled: boolean;
}

const DEFAULTS: DesktopConfig = {
  serverUrl: "https://apivscode.ailancers.com",
  trackingEnabled: true,
  idleTimeoutSeconds: 600,
  telemetryIntervalSeconds: 60,
  screenCaptureEnabled: true,
  screenCaptureIntervalSeconds: 300,
  autoStartEnabled: false,
};

export class ConfigStore {
  private configPath: string;
  private data: DesktopConfig;

  constructor() {
    this.configPath = path.join(app.getPath("userData"), "config.json");
    this.data = { ...DEFAULTS };
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, "utf-8");
        const parsed = JSON.parse(raw);
        this.data = { ...DEFAULTS, ...parsed };

        // Migration: replace stale Railway URL with new production domain
        if (typeof this.data.serverUrl === "string" && this.data.serverUrl.includes("exten-production.up.railway.app")) {
          this.data.serverUrl = DEFAULTS.serverUrl;
          this.save();
        }
      }
    } catch {
      this.data = { ...DEFAULTS };
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch {
      // Non-critical
    }
  }

  get<K extends keyof DesktopConfig>(key: K): DesktopConfig[K] {
    return this.data[key];
  }

  set<K extends keyof DesktopConfig>(key: K, value: DesktopConfig[K]): void {
    this.data[key] = value;
    this.save();
  }

  getAll(): DesktopConfig {
    return { ...this.data };
  }
}
