/**
 * HourlyTrackerReporter — HMAC-signed client for chat-ui hourly billing endpoints.
 * Uses the same AILANCERS_BILLING_API_URL + AILANCERS_BILLING_HMAC_SECRET as BillingReporter.
 */
import crypto from "node:crypto";
import type { Env } from "../config/env.js";

export interface TrackerStatusResponse {
  billing_status: string;
  enabled: boolean;
  weekly_hours_used: number;
  weekly_hour_limit: number;
  hours_remaining: number;
  weekly_spend_estimate?: number;
  hourly_rate?: number;
  suspended?: boolean;
  limit_reached?: boolean;
  is_hourly: boolean;
  slot_duration_minutes: number;
  lancer_user_id: string | null;
}

export interface SnapshotPayload {
  slot_id: string;
  sub_project_id: string;
  lancer_user_id: string;
  slot_start: string;
  screenshot_url?: string | null;
  screenshot_taken_at?: string | null;
  keyboard_hits: number;
  mouse_hits: number;
  activity_percent: number;
  memo?: string | null;
  active_window?: string | null;
}

export class HourlyTrackerReporter {
  private readonly apiUrl: string;
  private readonly hmacSecret: string;
  private readonly enabled: boolean;

  constructor(env: Env) {
    this.apiUrl = env.AILANCERS_BILLING_API_URL;
    this.hmacSecret = env.AILANCERS_BILLING_HMAC_SECRET;
    this.enabled = !!(this.apiUrl && this.hmacSecret);
    if (!this.enabled) {
      console.log("[HourlyTrackerReporter] Disabled — missing AILANCERS_BILLING_API_URL or HMAC_SECRET");
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async getStatus(subProjectId: string): Promise<TrackerStatusResponse | null> {
    if (!this.enabled) return null;
    try {
      const url = `${this.apiUrl}/hourly-billing/status?sub_project_id=${encodeURIComponent(subProjectId)}`;
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
      return (await response.json()) as TrackerStatusResponse;
    } catch (err) {
      console.error("[HourlyTrackerReporter] /status failed:", err);
      return null;
    }
  }

  async pushSnapshot(payload: SnapshotPayload): Promise<TrackerStatusResponse> {
    if (!this.enabled) throw new Error("HourlyTrackerReporter not configured");

    const bodyStr = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.sign(timestamp, bodyStr);

    const response = await fetch(`${this.apiUrl}/hourly-billing/snapshots`, {
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
      const error = new Error(`HTTP ${response.status}: ${text}`) as Error & {
        statusCode: number;
        body: string;
      };
      error.statusCode = response.status;
      error.body = text;
      throw error;
    }
    return (await response.json()) as TrackerStatusResponse;
  }

  private sign(timestamp: string, body: string): string {
    return crypto.createHmac("sha256", this.hmacSecret).update(`${timestamp}.${body}`).digest("hex");
  }
}
