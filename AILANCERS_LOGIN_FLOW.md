# "Login with Ailancers" — Implementation Reference

End-to-end documentation of the **device-code authentication flow** used by the dashboard, the VS Code extension, and the desktop tracker. Anyone implementing a new client or debugging a login bug should read this first.

> **Why "device-code"?** Native apps (Electron) and embedded webviews (VS Code) can't sanely host a secure web login form. So the client opens a browser, the user authenticates there, and the browser hands a one-time code back to the client over our backend. Same idea as `gh auth login`, GitHub Desktop, the AWS CLI, etc.

---

## TL;DR — What a user sees

1. User clicks **"Login with Ailancers"** in dashboard / extension / tracker.
2. Their default browser opens to `https://apivscode.ailancers.com/auth-bridge?code=ABC123`.
3. The bridge page either:
   - Detects an existing Ailancers session (cookie or localStorage) → auto-completes silently
   - Or asks them to sign in (Google OAuth or email/password)
4. Browser shows "✅ Connected. You can close this tab."
5. Client sees the login complete and is now signed in.

Whole thing takes 2–10 seconds when the user is already logged in to Ailancers in their browser, ~30 seconds the first time.

---

## Components

```
┌─────────────────┐         ┌──────────────────────────┐         ┌────────────────────────┐
│  CLIENT         │         │  OUR BACKEND             │         │  AILANCERS PLATFORM    │
│  (dashboard /   │ ◄─────► │  apivscode.ailancers.com │ ◄─────► │  staging-backend       │
│  extension /    │         │                          │         │  .ailancers.com        │
│  tracker)       │         │                          │         │                        │
└─────────────────┘         └──────────────────────────┘         └────────────────────────┘
        │                          │                                        │
        │ 1. POST /device-code     │                                        │
        │ ──────────────────────►  │                                        │
        │                          │ creates code, stores in memory         │
        │ ◄────────────────────── │                                        │
        │   { code: "ABC123" }    │                                        │
        │                          │                                        │
        │ 2. open browser to      │                                        │
        │    /auth-bridge?code=…  │                                        │
        │                          │                                        │
        │                          │  3. user authenticates in browser     │
        │                          │ ─────────────────────────────────────►│
        │                          │ ◄─────────────────────────────────────│
        │                          │     { token: "<platform-jwt>" }       │
        │                          │                                        │
        │                          │ 4. POST /device-code/complete         │
        │                          │    { code, platformToken }            │
        │                          │    server verifies token via          │
        │                          │    /api/v1/auth/verify, generates     │
        │                          │    a local JWT, attaches to code      │
        │                          │                                        │
        │ 5. GET /device-code/poll │                                        │
        │    every 2s              │                                        │
        │ ──────────────────────►  │                                        │
        │ ◄────────────────────── │                                        │
        │   { status, accessToken,│                                        │
        │     platformToken,user }│                                        │
        │                          │                                        │
        │ 6. store token, done    │                                        │
```

---

## Backend endpoints (file: `apps/backend/src/routes/auth.routes.ts`)

| Method | Path | Auth | What it does |
|--------|------|------|--------------|
| `POST` | `/api/auth/device-code` | none | Generates a random 8-char code, stores `{ code → { token: null, expiresAt: now+5min } }` in memory. Returns `{ code, expiresIn: 300 }`. |
| `POST` | `/api/auth/device-code/complete` | none | Body: `{ code, platformToken }`. Verifies the platform token by calling `https://staging-backend.ailancers.com/api/v1/auth/verify`. Looks up (or auto-creates) the local `users` row by email. Generates a local JWT. Attaches both tokens to the pending code entry. |
| `GET` | `/api/auth/device-code/poll?code=ABC` | none | Returns `{ status: "pending" }` until complete, `{ status: "complete", accessToken, platformToken, user }` once done, `{ status: "expired" }` after 5 minutes or if invalid. Deletes the entry on success. |
| `GET` | `/api/auth/google/callback?token=…&device_code=…` | none | Used when the bridge page sends users through Google OAuth. Same effect as `device-code/complete` but called server-side at the end of the OAuth redirect. |
| `GET` | `/auth-bridge?code=ABC` | none | Returns the HTML bridge page (~150 lines of inline HTML/JS). User-facing. |
| `POST` | `/api/auth/platform-proxy-login` | none | Body: `{ email, password }`. Proxies to `staging-backend.ailancers.com/api/v1/auth/login` to bypass CORS from the bridge page's browser. Returns `{ token }`. |
| `POST` | `/api/auth/platform-login` | none | Body: `{ platformToken }`. Same as `/device-code/complete` but for clients that already have a platform token (e.g. dashboard's auto-login from cookie). Returns `{ accessToken, user }`. |

### Storage — pending codes

```typescript
// In-memory only — survives a restart? No.
const pendingLogins = new Map<string, {
  token: string | null;          // local JWT
  platformToken: string | null;  // raw Ailancers token
  user: User | null;
  expiresAt: number;             // Date.now() + 5*60*1000
}>();
```

**Implication:** if the backend restarts mid-flow, in-flight logins fail. Users just retry; not worth persisting.

---

## The `/auth-bridge` page (apps/backend/src/routes/auth.routes.ts:167)

Self-contained HTML served from the backend, **not from the dashboard**. Why? Because:
1. It needs to read cookies from the `.ailancers.com` domain (the extension/tracker open it directly, no SPA round-trip)
2. It needs to call `/api/auth/device-code/complete` cross-domain — easier when same-origin

What the page does:

1. **Auto-login attempt** — checks for `ailance_token` cookie or `localStorage["ailance_token"]`. If found, posts directly to `/api/auth/device-code/complete` and shows "Connected!" without a login form
2. **Google OAuth button** — redirects to `https://staging-backend.ailancers.com/api/v1/auth/google/login?redirect_uri=…/google/callback?device_code=ABC`
3. **Email/password form** — POSTs to `/api/auth/platform-proxy-login` (avoids CORS), then forwards the platform token to `/device-code/complete`

---

## Client implementations

All three clients follow the same 5-step pattern:

### 1. VS Code extension (`apps/extension/src/providers/ChatViewProvider.ts:181-200`)

```typescript
async handleBrowserLogin() {
  // Step 1: Get a device code
  const { code } = await fetch(`${serverUrl}/api/auth/device-code`, { method: "POST" }).then(r => r.json());

  // Step 2: Open the user's default browser
  vscode.env.openExternal(vscode.Uri.parse(`${serverUrl}/auth-bridge?code=${code}`));

  // Step 3: Poll every 2 seconds, max 5 minutes
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const poll = await fetch(`${serverUrl}/api/auth/device-code/poll?code=${code}`).then(r => r.json());
    if (poll.status === "complete") {
      // Step 4: Store the platform token (used for Ailancers project fetching)
      await this.authService.loginWithToken(poll.platformToken || poll.accessToken, poll.user);
      return;
    }
    if (poll.status === "expired") throw new Error("Login expired");
  }
}
```

### 2. Desktop tracker (`apps/desktop/src/main/ipc/handlers.ts:25-50`)

Identical pattern, except it uses `shell.openExternal` instead of `vscode.env.openExternal`, and stores tokens in OS keychain via `SecureStore`.

### 3. Dashboard (`apps/dashboard/src/app/login/page.tsx:51-66`)

Identical pattern, except it uses `window.open(...)` to launch the browser tab and stores tokens in localStorage.

The dashboard ALSO has an **auto-login on first load**: `AuthProvider.tsx` checks for an `ailance_token` cookie (set by the parent `.ailancers.com` site) and calls `/api/auth/platform-login` directly, skipping the device-code dance entirely. That's why opening the dashboard while logged into Ailancers in another tab feels instant.

---

## Token semantics

The flow yields **two tokens** at the end. Both matter:

| Token | Source | Used for |
|-------|--------|----------|
| **`platformToken`** | Original Ailancers JWT from `staging-backend.ailancers.com` | Calling Ailancers's own APIs (`/v2/projects`, `/v1/auth/verify`, billing endpoints). Has the platform user's UUID and roles. |
| **`accessToken`** (local JWT) | Generated by our backend after verifying the platform token | Calling our own `/api/...` endpoints. Has the local `users.id` and our role taxonomy. |

`requireAuth` middleware accepts **either token** — it tries local JWT first, falls back to verifying as a platform token (cached for 10 min). So clients can send either, but **most clients store both** so they can call both APIs without round-trips.

---

## Implementing it for a new client

Five steps. Total ~50 lines of code.

```typescript
// Configuration
const SERVER_URL = "https://apivscode.ailancers.com";

async function loginWithAilancers(): Promise<{ accessToken: string; platformToken: string; user: User }> {
  // 1. Request a device code
  const codeRes = await fetch(`${SERVER_URL}/api/auth/device-code`, { method: "POST" });
  if (!codeRes.ok) throw new Error("Couldn't start login");
  const { code } = await codeRes.json();

  // 2. Open the browser to the bridge page
  //    (use whatever your platform's browser-launching API is)
  openBrowser(`${SERVER_URL}/auth-bridge?code=${code}`);

  // 3. Poll until completion or 5-minute timeout
  for (let attempt = 0; attempt < 150; attempt++) {
    await sleep(2000);
    const pollRes = await fetch(`${SERVER_URL}/api/auth/device-code/poll?code=${code}`);
    if (!pollRes.ok) continue;
    const poll = await pollRes.json();

    if (poll.status === "complete") {
      // 4. Store both tokens — platformToken is needed for project fetching
      return {
        accessToken: poll.accessToken,
        platformToken: poll.platformToken,
        user: poll.user,
      };
    }
    if (poll.status === "expired") {
      throw new Error("Login expired. Try again.");
    }
    // status === "pending" → keep polling
  }
  throw new Error("Login timed out");
}

// 5. Use the token on every request
fetch(`${SERVER_URL}/api/...`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

That's it. 5 minutes to implement once you've read this doc.

---

## Token refresh

Currently **none**. Tokens have whatever expiry Ailancers sets (typically 30 days for the platform token, configurable for the local JWT via `JWT_ACCESS_EXPIRY` env var).

When a token expires:
- API calls return `401`
- Dashboard's global error handler ([apps/dashboard/src/components/AuthProvider.tsx](apps/dashboard/src/components/AuthProvider.tsx)) clears the session and redirects to login
- Extension and tracker show their login screens

If we want silent refresh, we'd add a `/api/auth/refresh` flow using the existing `refreshTokens` table (already in the DB schema). Not implemented yet.

---

## Common debugging recipes

### "Login expired" after every attempt
- The `/device-code/poll` endpoint has a 5-min ceiling. If polling doesn't see `complete` within 5 minutes, it returns `expired`.
- Most likely cause: the bridge page's `/device-code/complete` POST never went through. Check browser devtools on the bridge page for a 4xx or CORS error.

### "Couldn't get token" when running the bridge form
- Bridge calls `/api/auth/platform-proxy-login` which proxies to `staging-backend.ailancers.com`. If that endpoint is down or slow → 502. Check `journalctl -u ailancers-backend` for the proxy error.

### Browser opens but the page is blank
- The backend either isn't serving `/auth-bridge` (verify the route is registered) or the page is hitting a JS error. Open devtools.

### Auto-login from cookie doesn't work
- The `ailance_token` cookie must be set on `.ailancers.com` (any subdomain). If users log into `staging.ailancers.com`, the cookie is fine. If they log into `localhost:3000` it isn't.
- Cookie must NOT be `HttpOnly` (the bridge page reads it from JS). Check Set-Cookie headers from the platform.

### Tokens leaked
- The `platformToken` is sent through our backend during `/device-code/complete`. We log nothing about it. The `accessToken` (local JWT) is signed by `JWT_SECRET` from `.env` — if that leaks, **rotate it immediately** and every existing session invalidates.

---

## Files of interest

| File | Role |
|------|------|
| [apps/backend/src/routes/auth.routes.ts](apps/backend/src/routes/auth.routes.ts) | All auth endpoints + the `/auth-bridge` HTML page (lines 167–311) |
| [apps/backend/src/services/AuthService.ts](apps/backend/src/services/AuthService.ts) | `verifyPlatformToken()` calls Ailancers verify, auto-creates local user |
| [apps/backend/src/middleware/requireAuth.ts](apps/backend/src/middleware/requireAuth.ts) | Token validation order: local JWT first, fall back to platform |
| [apps/extension/src/providers/ChatViewProvider.ts](apps/extension/src/providers/ChatViewProvider.ts) | `handleBrowserLogin()` |
| [apps/desktop/src/main/ipc/handlers.ts](apps/desktop/src/main/ipc/handlers.ts) | `loginWithBrowser` IPC handler |
| [apps/dashboard/src/app/login/page.tsx](apps/dashboard/src/app/login/page.tsx) | "Login with Ailancers" button + polling |
| [apps/dashboard/src/components/AuthProvider.tsx](apps/dashboard/src/components/AuthProvider.tsx) | Auto-login from `ailance_token` cookie + 401 → redirect |

---

## Status

| Date | Status |
|------|--------|
| 2026-04-21 | First implementation (commit `a09cefd`) |
| 2026-04-23 | Auth bridge added Google OAuth + auto-login from cookie (commit `f8dc87a`) |
| 2026-04-23 | Platform proxy added to bypass CORS (commit `8e6ced4`) |
| 2026-04-30 | Doc written from existing code |
