/**
 * Inbound HMAC verifier — mirrors the outbound `sha256(timestamp + "." + body)`
 * pattern used by HourlyTrackerReporter / BillingReporter when SIGNING
 * outgoing requests to chat-ui. Now also used the other way around: chat-ui
 * (agency portal backend) signs requests TO this vscode-ext backend for
 * the tracker-hours rollup.
 *
 * Shared secret: `AILANCERS_BILLING_HMAC_SECRET` in env. Same value on both
 * sides — no key distribution to worry about, no rotation pain in v1.
 *
 * Replay-window: 5 min. A captured request can be replayed within that
 * window but signatures expire after, so old logs can't be weaponized.
 */
import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";

const REPLAY_WINDOW_SECONDS = 5 * 60;

export interface HmacVerifyResult {
  ok: boolean;
  /** Reason the verify failed; useful for log lines. Omit if ok=true. */
  reason?: "missing_headers" | "stale_timestamp" | "bad_signature";
}

/**
 * Verify a billing-HMAC-signed request.
 *
 * @param request   Fastify request (must have rawBody for non-GET — see note)
 * @param secret    Shared HMAC secret
 * @param rawBody   Raw request body string. For GET/DELETE pass "".
 *
 * NOTE on rawBody: Fastify parses JSON eagerly, so re-serializing
 * `request.body` is NOT byte-identical to what the caller signed. The
 * caller should either:
 *   - sign over an empty string (GET / no-body methods), or
 *   - register `app.addContentTypeParser('application/json', { parseAs: 'buffer' }, ...)`
 *     to keep the raw bytes and pass them here.
 * The tracker-hours endpoint is GET-only, so empty-body signing is fine
 * for v1 and we don't need the buffer parser.
 */
export function verifyBillingHmac(
  request: FastifyRequest,
  secret: string,
  rawBody: string,
): HmacVerifyResult {
  const sigHeader = request.headers["x-billing-signature"];
  const tsHeader = request.headers["x-billing-timestamp"];
  if (typeof sigHeader !== "string" || typeof tsHeader !== "string") {
    return { ok: false, reason: "missing_headers" };
  }

  // Reject stale / clock-skewed timestamps. parseInt covers integer
  // strings; anything else fails the abs() check below.
  const ts = parseInt(tsHeader, 10);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${rawBody}`)
    .digest("hex");
  const expectedHeader = `sha256=${expected}`;

  // Constant-time compare. Both buffers must be the same length for
  // timingSafeEqual; mismatch in length is itself a failure (and the
  // Buffer.byteLength check below avoids the timing-side-channel hit
  // from comparing different-length signatures).
  const provided = Buffer.from(sigHeader);
  const expectedBuf = Buffer.from(expectedHeader);
  if (provided.length !== expectedBuf.length) {
    return { ok: false, reason: "bad_signature" };
  }
  if (!crypto.timingSafeEqual(provided, expectedBuf)) {
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: true };
}
