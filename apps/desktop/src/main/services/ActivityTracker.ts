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

  /** True when the screen is locked. Updated every 5s via SystemIdleService. */
  get isScreenLocked(): boolean {
    return this.idleService.isScreenLocked;
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
    const rawElapsed = Math.round((now - this.lastTickTime) / 1000);
    this.lastTickTime = now;
    // Guard against suspended timers — laptop sleep, OS power-saver, system
    // hibernate. Tick fires every 1s, so a gap >5s means we weren't actually
    // running. The wall-clock seconds in that gap are NOT work time (the
    // user wasn't using the computer), so drop the tick rather than dumping
    // the whole gap into activeSeconds. Without this, an 8h sleep shows up
    // as 8h of "active" work the moment the laptop wakes — backend clamp
    // catches it server-side, but the tray UI would still flash bad numbers
    // until the next heartbeat.
    if (rawElapsed > 5) return;
    // Drop ticks while the screen is locked — locked time isn't work time.
    // OS-idle can't see this; unlocking counts as input so idle resets to 0.
    if (this.idleService.isScreenLocked) return;
    const elapsed = rawElapsed;

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
