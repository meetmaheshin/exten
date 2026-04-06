import type { SystemIdleService } from "./SystemIdleService";
import type { ConfigStore } from "./ConfigStore";

export interface DesktopActivitySnapshot {
  activeSeconds: number;
  idleSeconds: number;
  isCurrentlyIdle: boolean;
  appUsage: Record<string, number>;
}

export class ActivityTracker {
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private _activeSeconds = 0;
  private _idleSeconds = 0;
  private _isIdle = false;
  private lastTickTime = Date.now();

  constructor(
    private idleService: SystemIdleService,
    private configStore: ConfigStore
  ) {}

  start(): void {
    if (this.tickInterval) return;
    this.lastTickTime = Date.now();
    this.tickInterval = setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  get isIdle(): boolean {
    return this._isIdle;
  }

  /** Harvest metrics and reset counters. Called by TelemetryService before each flush. */
  harvestMetrics(): DesktopActivitySnapshot {
    const snapshot: DesktopActivitySnapshot = {
      activeSeconds: this._activeSeconds,
      idleSeconds: this._idleSeconds,
      isCurrentlyIdle: this._isIdle,
      appUsage: this.idleService.harvestAppUsage(),
    };

    this._activeSeconds = 0;
    this._idleSeconds = 0;

    return snapshot;
  }

  private tick(): void {
    const now = Date.now();
    const elapsed = Math.round((now - this.lastTickTime) / 1000);
    this.lastTickTime = now;

    const idleThreshold = this.configStore.get("idleTimeoutSeconds");
    const osIdle = this.idleService.osIdleSeconds;

    if (osIdle >= idleThreshold) {
      this._isIdle = true;
      this._idleSeconds += elapsed;
    } else {
      this._isIdle = false;
      this._activeSeconds += elapsed;
    }
  }

  dispose(): void {
    this.stop();
  }
}
