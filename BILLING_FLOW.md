# Ailancers — Projects, User Identity & Billing Flow

This document explains how the extension/desktop tracker fetches projects, identifies the user, and reports AI usage to the Ailancers billing API.

---

## Overview

```
┌──────────────┐    1. Login        ┌────────────────────────┐
│   Extension  │ ──────────────────▶│  Staging Backend        │
│  (VS Code or │                    │  staging-backend        │
│  Desktop)    │◀────────────────── │  .ailancers.com         │
│              │    platform JWT    │                         │
└──────┬───────┘                    └────────────────────────┘
       │                                       ▲
       │ 2. Fetch                              │ 5. POST billing
       │    projects                           │    (every 3 min)
       ▼                                       │
┌──────────────┐                    ┌─────────┴──────────────┐
│  Staging     │                    │  Our Railway Backend    │
│  Backend     │                    │  (Fastify)              │
│  /v2/*       │◀───────────────────│                         │
└──────────────┘ 3. WS: AI message  └────────────────────────┘
                    + subProjectId       ▲
                                         │
                                         │ 4. AI request
                                         ▼
                                    ┌────────────────┐
                                    │  Anthropic /   │
                                    │  OpenAI API    │
                                    └────────────────┘
```

---

## 1. Login & User Identity

### Extension-side (`apps/extension/src/services/AuthService.ts`)

The extension logs the user in via the Ailancers staging backend:

```
POST https://staging-backend.ailancers.com/api/v1/auth/login
Body: { "email": "...", "password": "..." }
→ { "token": "<platform JWT>", "user": {...} }
```

The platform JWT is stored in VS Code's `SecretStorage` and used as the Bearer token for all subsequent API calls.

### Backend-side (`apps/backend/src/services/AuthService.ts`)

When the extension connects to our WebSocket (`/api/chat/stream?token=<platform JWT>`), the backend:

1. Tries to verify the token as a **local JWT** (our own JWT issued by `/api/auth/login`).
2. If that fails, it calls `verifyPlatformToken()`:
   ```
   GET https://staging-backend.ailancers.com/api/v1/auth/verify
   Authorization: Bearer <platform JWT>
   → { user: { id: "7a8bc6e7-...", email, name, role, ... } }
   ```
3. The backend then either finds or auto-creates a **local user** with that email in our `users` table.
4. The returned JWT payload contains:
   ```typescript
   {
     sub: localUser.id,           // internal DB UUID (412a3c35-...)
     email: "...",
     role: "developer",
     platformUserId: "7a8bc6e7-..." // platform UUID — used for billing
   }
   ```

**Two IDs to remember:**
- `userId` = `localUser.id` — our Railway DB user ID (used for internal tracking, sessions, screenshots)
- `platformUserId` = `platformUser.id` — Ailancers platform user ID (used for billing as `lancer_user_id`)

The verify result is cached for 5 minutes to avoid hammering the staging backend.

---

## 2. Fetching Projects

### Extension fetches directly from the platform

`apps/extension/src/services/ProjectPickerService.ts` makes direct calls to the staging backend using the user's platform JWT (no proxying through our backend):

#### Step 1: Fetch all projects the user is part of

```
GET https://staging-backend.ailancers.com/api/v2/projects?page_size=100
Authorization: Bearer <platform JWT>
```

Response shape:
```json
{
  "items": [
    {
      "id": "c0491270-d277-4082-9b71-3f54fe70b642",
      "project_code": "PRJ-CEF6CDF0",
      "title": "deploying vs coding agent with ailancer",
      "total_budget": 10.0,
      "currency": "USD",
      "status": "OPEN",
      "priority": "MEDIUM",
      "sub_project_count": 1
    },
    ...
  ],
  "total": 46,
  "page": 1,
  "page_size": 100
}
```

The extension caches these projects in `globalState` for 5 minutes.

#### Step 2: User picks a project → fetch its sub-projects

When the user picks a project from the QuickPick, the extension fetches:

```
GET https://staging-backend.ailancers.com/api/v2/projects/{projectId}/sub-projects?page_size=100
Authorization: Bearer <platform JWT>
```

Response shape:
```json
{
  "items": [
    {
      "id": "20e8b1a2-0eee-46ff-ad68-5622b648c6a2",  // ← sub_project_id for billing
      "project_id": "c0491270-d277-4082-9b71-3f54fe70b642",
      "title": "deploying vs coding agent with ailancer",
      "priority": "MEDIUM",
      "budget": 10.0,
      "currency": "USD",
      "assigned_to": null
    }
  ],
  "total": 1
}
```

#### Step 3: Save the selection

After picking a sub-project, the extension stores:

```typescript
{
  projectId: "c0491270-...",      // parent project ID
  projectName: "deploying vs coding agent with ailancer",
  subProjectId: "20e8b1a2-...",   // ← THIS IS THE BILLING ID
  subProjectName: "deploying vs coding agent with ailancer"
}
```

Persisted in `globalState` under `ailancers.activeSelection` so it survives VS Code restarts.

---

## 3. Sending AI Messages with `subProjectId`

When the user sends a chat or agent message, the extension (`ChatService.ts`) injects the current `subProjectId` into the WebSocket payload:

```typescript
// apps/extension/src/services/ChatService.ts
this.wsClient.send({
  type: "agent_message",
  conversationId,
  content,
  model,
  agentType,
  subProjectId: this.projectPicker?.activeSubProjectId ?? null,
});
```

**Message shape on the wire:**
```json
{
  "type": "agent_message",
  "conversationId": "uuid",
  "content": "Write me a function...",
  "model": "claude-sonnet-4-6",
  "agentType": "coder",
  "subProjectId": "20e8b1a2-0eee-46ff-ad68-5622b648c6a2"
}
```

---

## 4. Backend Processes the Message

### `apps/backend/src/routes/chat.ws.ts`

1. Verifies the user's JWT (local or platform) — gets `userId` and `platformUserId`
2. Extracts `subProjectId` from the WebSocket message
3. Checks billing status before allowing the AI call:
   ```typescript
   if (billingReporter && subProjectId) {
     const status = await billingReporter.getBillingStatus(subProjectId, platformUserId || userId);
     if (status?.billingStatus === "SUSPENDED") {
       send(socket, { type: "billing_suspended", ... });
       return;
     }
     if (status?.capPercent >= 100) {
       send(socket, { type: "billing_suspended", reason: "CAP_REACHED", ... });
       return;
     }
   }
   ```
4. Calls Anthropic/OpenAI API, streams response back to the extension
5. On completion, records usage:
   ```typescript
   billingReporter.recordUsage(
     subProjectId,                   // sub-project UUID
     platformUserId || userId,       // platform user UUID
     model,                          // e.g. "claude-sonnet-4-6"
     result.inputTokens,             // e.g. 3389
     result.outputTokens,            // e.g. 163
   );
   ```

---

## 5. BillingReporter — Accumulate & Flush

### `apps/backend/src/services/BillingReporter.ts`

`recordUsage()` **accumulates** usage in memory, keyed by `{subProjectId}:{model}`. Multiple AI calls for the same sub-project + model are combined into one batch.

Every 3 minutes (configurable via `AILANCERS_BILLING_REPORT_INTERVAL_MS`), `flush()` sends each batch to the staging backend:

```
POST https://staging-backend.ailancers.com/api/v1/ai-billing/usage
Headers:
  Content-Type: application/json
  X-Billing-Signature: sha256=<hmac>
  X-Billing-Timestamp: <unix-timestamp>

Body:
{
  "batch_id": "6e01f43f-19f4-4f2c-9b83-a7f90c0d89cb",
  "sub_project_id": "20e8b1a2-0eee-46ff-ad68-5622b648c6a2",
  "lancer_user_id": "7a8bc6e7-1624-474f-a5ef-d7ee04b5404a",
  "model": "claude-sonnet-4-6",
  "input_tokens": 3389,
  "output_tokens": 163,
  "period_start": "2026-04-08T08:48:16.095Z",
  "period_end": "2026-04-08T08:48:16.095Z"
}
```

### HMAC Signing

The request is signed with `AILANCERS_BILLING_HMAC_SECRET`:

```typescript
const message = `${timestamp}.${bodyStr}`;
const signature = crypto.createHmac("sha256", HMAC_SECRET).update(message).digest("hex");
```

The staging backend verifies this signature before accepting the batch.

### Response

The staging backend responds with the current billing status:

```json
{
  "billing_status": "ACTIVE",    // or "SUSPENDED"
  "enabled": true,
  "today_spend": 0.42,
  "daily_cap": 10.0,
  "cap_remaining": 9.58,
  "cap_percent": 4.2
}
```

This is cached locally. If `cap_percent >= 100` or `billing_status === "SUSPENDED"`, future AI requests for that sub-project are blocked with a `billing_suspended` WebSocket message.

### Blocked Project Polling

If any sub-project becomes blocked (cap reached or suspended), `BillingReporter` starts a separate polling loop that hits `GET /ai-billing/status?sub_project_id=X&user_id=Y` every 3 minutes to detect when it becomes unblocked. When all projects are unblocked, polling stops.

---

## 6. Environment Variables

Required for billing to work:

```env
# Billing API base URL
AILANCERS_BILLING_API_URL=https://staging-backend.ailancers.com/api/v1

# Shared secret for HMAC signing (coordinated with staging backend)
AILANCERS_BILLING_HMAC_SECRET=<64-char hex>

# Flush interval (default 3 minutes)
AILANCERS_BILLING_REPORT_INTERVAL_MS=180000
```

If `AILANCERS_BILLING_API_URL` or `AILANCERS_BILLING_HMAC_SECRET` is empty, the `BillingReporter` runs in **disabled mode** — usage is still tracked in our `ai_usage_daily` table but nothing is sent externally.

---

## 7. Observability — Railway Logs

Search for these prefixes:

| Filter | What you'll see |
|--------|-----------------|
| `[Chat WS] User connected` | User ID mapping: `userId=... platformUserId=...` |
| `[BillingReporter] Started` | Billing service started with flush interval |
| `[BillingReporter] Sending to` | URL of each outgoing billing batch |
| `[BillingReporter] Payload:` | Full JSON body being sent |
| `[BillingReporter] Response` | HTTP status + body of staging backend response |
| `[BillingReporter] Reported:` | Successful batch (model + tokens + sub-project) |
| `[BillingReporter] Failed to send batch` | Error (HTTP or network) |

Example successful flow:
```
[Chat WS] User connected: userId=412a3c35-..., platformUserId=7a8bc6e7-...
[BillingReporter] Sending to https://staging-backend.ailancers.com/api/v1/ai-billing/usage:
[BillingReporter] Payload: {"batch_id":"...","sub_project_id":"20e8b1a2-...","lancer_user_id":"7a8bc6e7-...","model":"claude-sonnet-4-6","input_tokens":3389,"output_tokens":163,...}
[BillingReporter] Headers: X-Billing-Timestamp=1775..., X-Billing-Signature=sha256=a1b2c3d4...
[BillingReporter] Response 200: OK
[BillingReporter] Reported: claude-sonnet-4-6 3389in/163out for sp=20e8b1a2-... (batch=6e01f43f-...)
```

---

## 8. Quick Reference — Where Things Live

| Concern | File |
|---------|------|
| Platform login | `apps/extension/src/services/AuthService.ts` |
| Fetch projects / sub-projects | `apps/extension/src/services/ProjectPickerService.ts` |
| Send WS messages with `subProjectId` | `apps/extension/src/services/ChatService.ts` |
| Verify platform JWT on backend | `apps/backend/src/services/AuthService.ts` (`verifyPlatformToken`) |
| Billing accumulator + flusher | `apps/backend/src/services/BillingReporter.ts` |
| Chat WS handler that records usage | `apps/backend/src/routes/chat.ws.ts` |
| Billing status API for extension | `apps/backend/src/routes/billing.routes.ts` |
| WebSocket protocol types | `packages/shared-types/src/chat.ts`, `.../agent.ts` |

---

## 9. Common Issues

### `lancer_user_id` is empty or wrong
- Make sure the user logged in via **platform token**, not local JWT.
- `verifyPlatformToken()` must set `platformUserId` in the returned `JwtPayload`.
- `chat.ws.ts` must extract `payload.platformUserId` and pass it to `recordUsage`.

### Billing reports not going out
- Check Railway logs for `[BillingReporter] Started` on startup.
- If it says `Disabled — AILANCERS_BILLING_API_URL or AILANCERS_BILLING_HMAC_SECRET not set`, the env vars are missing.
- Make sure the user has selected a sub-project (`activeSubProjectId` must be non-null).
- `recordUsage` is only called when `billingReporter && subProjectId` are both truthy.

### HTTP 400 from staging backend
- Check the payload log — we are sending the correct shape.
- A 400 with `UsageBatchRequest is not fully defined` is a bug on the **staging backend's** Pydantic model, not ours.

### Projects not showing in picker
- Check that the user has projects on the staging platform (`GET /v2/projects` must return non-empty `items`).
- The extension calls the API directly with the platform JWT — if the token is expired, refresh via login.
