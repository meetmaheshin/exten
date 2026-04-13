/**
 * BillingReporter — Accumulates AI token usage and batch-reports to ailancers-chat-ui.
 *
 * Flow:
 *  1. After each AI response, `recordUsage()` accumulates tokens in memory
 *  2. Every 3 minutes (configurable), `flush()` sends HMAC-signed POST to chat-ui
 *  3. Chat-ui response includes billing status, cached locally
 *  4. `getBillingStatus()` returns cached status (or fetches on cold start)
 */
import crypto from "node:crypto";
import type { Env } from "../config/env.js";

interface UsageBatch {
  subProjectId: string;
  lancerUserId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  periodStart: Date;
  periodEnd: Date;
}

interface BillingStatus {
  billingStatus: string; // "ACTIVE" | "SUSPENDED" | "DISABLED" | "no_config"
  enabled: boolean;
  todaySpend: number;
  dailyCap: number | null;
  capRemaining: number | null;
  capPercent: number;
  fetchedAt: number; // Date.now()
}

export class BillingReporter {
  private accumulator: Map<string, UsageBatch> = new Map();
  private statusCache: Map<string, BillingStatus> = new Map();
  private userIdByProject: Map<string, string> = new Map(); // subProjectId → userId
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private statusPollInterval: ReturnType<typeof setInterval> | null = null;
  private blockedProjects: Set<string> = new Set(); // Projects with cap reached or suspended
  private readonly apiUrl: string;
  private readonly hmacSecret: string;
  private readonly intervalMs: number;
  private readonly enabled: boolean;

  constructor(env: Env) {
    this.apiUrl = env.AILANCERS_BILLING_API_URL;
    this.hmacSecret = env.AILANCERS_BILLING_HMAC_SECRET;
    this.intervalMs = env.AILANCERS_BILLING_REPORT_INTERVAL_MS;
    this.enabled = !!(this.apiUrl && this.hmacSecret);

    if (!this.enabled) {
      console.log("[BillingReporter] Disabled — AILANCERS_BILLING_API_URL or AILANCERS_BILLING_HMAC_SECRET not set");
    }
  }

  /** Start the periodic flush timer. Call once on app startup. */
  start(): void {
    if (!this.enabled) return;
    this.flushInterval = setInterval(() => this.flush(), this.intervalMs);
    console.log(`[BillingReporter] Started — flushing every ${this.intervalMs / 1000}s`);
  }

  /** Stop the periodic flush timer. Call on app shutdown. */
  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.stopStatusPolling();
    // Final flush
    this.flush().catch((e) => console.error("[BillingReporter] Final flush failed:", e));
  }

  /**
   * Record token usage from an AI response.
   * Called after every AI request completes.
   */
  recordUsage(
    subProjectId: string,
    lancerUserId: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    if (!this.enabled || !subProjectId) return;

    // Track user ID per sub-project for status checks
    this.userIdByProject.set(subProjectId, lancerUserId);

    const key = `${subProjectId}:${model}`;
    const existing = this.accumulator.get(key);
    const now = new Date();

    if (existing) {
      existing.inputTokens += inputTokens;
      existing.outputTokens += outputTokens;
      existing.periodEnd = now;
    } else {
      this.accumulator.set(key, {
        subProjectId,
        lancerUserId,
        model,
        inputTokens,
        outputTokens,
        periodStart: now,
        periodEnd: now,
      });
    }
  }

  /**
   * Get cached billing status for a sub-project.
   * On cold start (no cache), fetches from chat-ui synchronously.
   */
  async getBillingStatus(subProjectId: string, userId?: string): Promise<BillingStatus | null> {
    if (!this.enabled || !subProjectId) return null;

    // Store userId for status checks if provided
    if (userId) {
      this.userIdByProject.set(subProjectId, userId);
    }

    const cached = this.statusCache.get(subProjectId);
    // Cache valid for 5 minutes
    if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) {
      return cached;
    }

    // Cold start or cache expired — fetch from chat-ui
    const status = await this.fetchStatusFromServer(subProjectId);
    if (status) {
      this.statusCache.set(subProjectId, status);
    }
    return status;
  }

  /** Check if billing is suspended for a sub-project. */
  async isSuspended(subProjectId: string): Promise<boolean> {
    const status = await this.getBillingStatus(subProjectId);
    return status?.billingStatus === "SUSPENDED";
  }

  /** Flush accumulated usage to chat-ui. Called every 3 minutes. */
  private async flush(): Promise<void> {
    if (this.accumulator.size === 0) return;

    // Snapshot and clear accumulator
    const batches = Array.from(this.accumulator.values());
    this.accumulator.clear();

    for (const batch of batches) {
      try {
        await this.sendBatch(batch);
      } catch (e) {
        console.error(`[BillingReporter] Failed to send batch for ${batch.subProjectId}:${batch.model}:`, e);
        // Put back in accumulator for retry on next flush
        const key = `${batch.subProjectId}:${batch.model}`;
        const existing = this.accumulator.get(key);
        if (existing) {
          existing.inputTokens += batch.inputTokens;
          existing.outputTokens += batch.outputTokens;
        } else {
          this.accumulator.set(key, batch);
        }
      }
    }
  }

  /** Send a single batch to chat-ui. */
  private async sendBatch(batch: UsageBatch): Promise<void> {
    const batchId = crypto.randomUUID();
    const payload = {
      batch_id: batchId,
      sub_project_id: batch.subProjectId,
      lancer_user_id: batch.lancerUserId,
      model: batch.model,
      input_tokens: batch.inputTokens,
      output_tokens: batch.outputTokens,
      period_start: batch.periodStart.toISOString(),
      period_end: batch.periodEnd.toISOString(),
    };

    const bodyStr = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.sign(timestamp, bodyStr);

    const url = `${this.apiUrl}/ai-billing/usage`;
    console.log(`[BillingReporter] Sending to ${url}:`);
    console.log(`[BillingReporter] Payload: ${bodyStr}`);
    console.log(`[BillingReporter] Headers: X-Billing-Timestamp=${timestamp}, X-Billing-Signature=sha256=${signature.slice(0, 16)}...`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Billing-Signature": `sha256=${signature}`,
        "X-Billing-Timestamp": timestamp,
      },
      body: bodyStr,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(`[BillingReporter] Response ${response.status}: ${text}`);
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    console.log(`[BillingReporter] Response ${response.status}: OK`);

    // Update cached billing status from response
    const data = await response.json() as Record<string, unknown>;
    if (data.billing_status) {
      const status: BillingStatus = {
        billingStatus: (data.billing_status as string),
        enabled: (data.enabled as boolean) || false,
        todaySpend: (data.today_spend as number) || 0,
        dailyCap: (data.daily_cap as number) || null,
        capRemaining: (data.cap_remaining as number) || null,
        capPercent: (data.cap_percent as number) || 0,
        fetchedAt: Date.now(),
      };
      this.statusCache.set(batch.subProjectId, status);

      // Track blocked projects — start polling if blocked, stop if unblocked
      const isBlocked = status.billingStatus === "SUSPENDED" || status.capPercent >= 100;
      if (isBlocked) {
        this.blockedProjects.add(batch.subProjectId);
        this.startStatusPolling();
      } else {
        this.blockedProjects.delete(batch.subProjectId);
        if (this.blockedProjects.size === 0) {
          this.stopStatusPolling();
        }
      }
    }

    console.log(
      `[BillingReporter] Reported: ${batch.model} ${batch.inputTokens}in/${batch.outputTokens}out ` +
      `for sp=${batch.subProjectId} (batch=${batchId})`
    );
  }

  /**
   * Poll status for blocked projects every 3 min.
   * Runs only when there are projects blocked by cap or suspension.
   * Stops automatically when all projects are unblocked.
   */
  private startStatusPolling(): void {
    if (this.statusPollInterval) return; // Already polling
    console.log("[BillingReporter] Starting status poll for blocked projects");
    this.statusPollInterval = setInterval(() => this.pollBlockedProjects(), this.intervalMs);
  }

  private stopStatusPolling(): void {
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval);
      this.statusPollInterval = null;
      console.log("[BillingReporter] Stopped status polling — all projects unblocked");
    }
  }

  private async pollBlockedProjects(): Promise<void> {
    for (const spId of this.blockedProjects) {
      try {
        const status = await this.fetchStatusFromServer(spId);
        if (status) {
          this.statusCache.set(spId, status);
          const stillBlocked = status.billingStatus === "SUSPENDED" || status.capPercent >= 100;
          if (!stillBlocked) {
            this.blockedProjects.delete(spId);
            console.log(`[BillingReporter] Project ${spId} unblocked — cap increased or billing resumed`);
          }
        }
      } catch (e) {
        console.warn(`[BillingReporter] Status poll failed for ${spId}:`, e);
      }
    }
    if (this.blockedProjects.size === 0) {
      this.stopStatusPolling();
    }
  }

  private async fetchStatusFromServer(subProjectId: string): Promise<BillingStatus | null> {
    try {
      const userId = this.userIdByProject.get(subProjectId);
      let url = `${this.apiUrl}/ai-billing/status?sub_project_id=${encodeURIComponent(subProjectId)}`;
      if (userId) {
        url += `&user_id=${encodeURIComponent(userId)}`;
      }
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = this.sign(timestamp, "");

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Billing-Signature": `sha256=${signature}`,
          "X-Billing-Timestamp": timestamp,
        },
      });

      if (!response.ok) return null;

      const data = await response.json() as Record<string, unknown>;
      return {
        billingStatus: (data.billing_status as string) || "no_config",
        enabled: (data.enabled as boolean) || false,
        todaySpend: (data.today_spend as number) || 0,
        dailyCap: (data.daily_cap as number) || null,
        capRemaining: (data.cap_remaining as number) || null,
        capPercent: (data.cap_percent as number) || 0,
        fetchedAt: Date.now(),
      };
    } catch (e) {
      return null;
    }
  }

  /** HMAC-SHA256 sign a message. */
  private sign(timestamp: string, body: string): string {
    const message = `${timestamp}.${body}`;
    return crypto.createHmac("sha256", this.hmacSecret).update(message).digest("hex");
  }
}
