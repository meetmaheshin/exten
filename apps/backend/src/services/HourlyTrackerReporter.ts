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

  async getStatus(
    subProjectId: string,
    lancerUserId?: string | null,
  ): Promise<TrackerStatusResponse | null> {
    if (!this.enabled) return null;
    const params = new URLSearchParams({ sub_project_id: subProjectId });
    if (lancerUserId) params.set("lancer_user_id", lancerUserId);
    const url = `${this.apiUrl}/hourly-billing/status?${params.toString()}`;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.sign(timestamp, "");
    try {
      console.log(
        `[HourlyTrackerReporter] GET ${url}  ts=${timestamp}  lancer=${lancerUserId ?? "-"}`,
      );
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Billing-Signature": `sha256=${signature}`,
          "X-Billing-Timestamp": timestamp,
        },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error(
          `[HourlyTrackerReporter] /status ${response.status}: ${body.slice(0, 400)}`,
        );
        return null;
      }
      const result = (await response.json()) as TrackerStatusResponse;
      console.log(
        `[HourlyTrackerReporter] /status OK: is_hourly=${result.is_hourly} billing_status=${result.billing_status} lancer=${result.lancer_user_id}`,
      );
      return result;
    } catch (err) {
      console.error("[HourlyTrackerReporter] /status network/parse failed:", err);
      return null;
    }
  }

  async pushSnapshot(payload: SnapshotPayload): Promise<TrackerStatusResponse> {
    if (!this.enabled) throw new Error("HourlyTrackerReporter not configured");

    const bodyStr = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.sign(timestamp, bodyStr);
    const url = `${this.apiUrl}/hourly-billing/snapshots`;

    console.log(
      `[HourlyTrackerReporter] POST ${url}  ts=${timestamp}  slot=${payload.slot_id}  lancer=${payload.lancer_user_id}  bytes=${bodyStr.length}`,
    );

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
      console.error(
        `[HourlyTrackerReporter] /snapshots ${response.status} for slot=${payload.slot_id}: ${text.slice(0, 400)}`,
      );
      const error = new Error(`HTTP ${response.status}: ${text}`) as Error & {
        statusCode: number;
        body: string;
      };
      error.statusCode = response.status;
      error.body = text;
      throw error;
    }
    const result = (await response.json()) as TrackerStatusResponse;
    console.log(
      `[HourlyTrackerReporter] /snapshots OK slot=${payload.slot_id}  is_hourly=${result.is_hourly}  billing_status=${result.billing_status}`,
    );
    return result;
  }

  private sign(timestamp: string, body: string): string {
    return crypto.createHmac("sha256", this.hmacSecret).update(`${timestamp}.${body}`).digest("hex");
  }
}
