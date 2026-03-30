# Client Request Tracker

Tracks feature/bug requests from the sgChat desktop client team and their review status.

## Status Legend

| Status | Meaning |
|--------|---------|
| `Pending` | Not yet reviewed by server team |
| `Implemented` | Changes made and deployed/merged |
| `Corrected` | Client had wrong data/endpoints — provided correct info |
| `Declined` | Request rejected with reasoning |
| `Modified` | Accepted with changes to the original request |

---

## Requests

| ID | Title | Priority | Status | Review Date | Notes |
|----|-------|----------|--------|-------------|-------|
| SRVREQ-auth-investigation | [Auth/Connection Investigation](SRVREQ-auth-investigation.md) | P0 | Implemented | 2026-03-28 | Per-session refresh tokens (redis.ts, auth.ts, users.ts). 3 of 5 concerns were non-issues; 2 valid + fixed |
| SRVREQ-member-list-ban-filter | [Filter Banned Users from Member List](SRVREQ-member-list-ban-filter.md) | P2 | Implemented | 2026-03-28 | Added NOT EXISTS ban subquery to findByServerId in db.ts |
| SRVREQ-e2e-encrypted-dms | [E2E Encrypted Direct Messages](SRVREQ-e2e-encrypted-dms.md) | P2 | Implemented | 2026-03-28 | Schema + key endpoints + encrypted message flow. Table renamed, server is dumb relay |
| SRVREQ-encryption-audit-at-rest | [Full Encryption Audit — Data at Rest](SRVREQ-encryption-audit-at-rest.md) | P2 | Implemented | 2026-03-28 | Redis auth + persistence disabled, MinIO SSE, backup script. pgcrypto + pg_tde declined |
| SRVREQ-custom-status-presence | [Custom Status Not Reflecting in Member List](SRVREQ-custom-status-presence.md) | P2 | Implemented | 2026-03-29 | Added missing custom_status_emoji + status_expires_at to member query; fixed presence event payload |
| SRVREQ-image-upload-404 | [Investigate Image Upload 404 Errors](SRVREQ-image-upload-404.md) | P1 | Corrected | 2026-03-29 | All endpoints exist — 404 is client-side path mismatch. Documented correct paths for client team |
| SRVREQ-noise-cancellation-mode | [Noise Cancellation Mode Remote Settings](SRVREQ-noise-cancellation-mode.md) | P3 | Implemented | 2026-03-29 | Added noise_cancellation_mode + ns_aggressiveness columns, server validation, legacy boolean sync. Also built web client RNNoise pipeline + UI |

---

## Review: SRVREQ-auth-investigation (P0)

**Status: Modified** — The investigation is worthwhile but most of the suspected issues are non-issues. Two items warrant server-side work.

### 1. Token Validation Consistency — NOT AN ISSUE
- REST uses `request.jwtVerify()` (Fastify JWT plugin) at [auth.ts:30](packages/api/src/middleware/auth.ts#L30)
- Socket.IO uses `fastify.jwt.verify(token)` at [socket/index.ts:127](packages/api/src/socket/index.ts#L127)
- **Same underlying JWT library, same secret, same expiry rules.** Verification is identical.
- **Response to client:** No inconsistency exists. If one works and the other doesn't, the token itself is the variable, not the verification.

### 2. Token Refresh Race Condition — VALID CONCERN
- `POST /auth/refresh` at [auth.ts:425](packages/api/src/routes/auth.ts#L425) calls `redis.deleteSession(session.userId)` which immediately invalidates the old refresh token.
- **Access tokens (JWTs) are stateless** — old access tokens remain valid until their 15-min expiry. No race condition there.
- **Refresh tokens are a per-user singleton** — `session:{userId}` stores exactly one refresh token. When device A refreshes, device B's refresh token becomes invalid.
- **This IS a real issue for multi-device users.** The client's concern is valid.
- **Recommended fix:** Move to per-session refresh tokens (e.g., `session:{userId}:{deviceId}`) instead of per-user singleton.

### 3. Crypto Session Handling — NOT AN ISSUE
- Crypto sessions are keyed by a random UUID (`sessionId`), stored in Redis as `crypto:{sessionId}`.
- **Per-session, not per-token or per-user.** Token refresh does not affect the crypto session.
- The `X-Crypto-Session` header is validated by looking up the UUID in Redis — completely independent of the JWT.
- **Response to client:** Crypto sessions survive token refresh. No action needed.

### 4. Rate Limiting on Auth Endpoints — NOT AN ISSUE (mostly)
- `/api/auth/check` — no custom rate limit, falls through to global: **100 requests per 60 seconds** (per user ID if authed, per IP otherwise)
- `/api/auth/refresh` — same global limit: **100/60s**
- `/api/auth/login` — **5 per 15 minutes per IP**
- The 100/60s global limit is generous enough that normal client behavior won't trigger 429.
- **Response to client:** Rate limits are reasonable. If the client is hitting 429 on auth endpoints, it's retrying too aggressively. The `autoLoginFailed` bailout on 429 is correct behavior.

### 5. Concurrent Session Handling — VALID CONCERN (same root as #2)
- **Socket sessions:** Fully supported via Redis Sets (`user_sessions:{userId}`). Multiple sockets work fine.
- **Refresh tokens:** Per-user singleton. Refreshing on one device invalidates all other devices' ability to refresh.
- **This is the same underlying issue as #2.** Fix the refresh token to be per-session and both concerns are resolved.

### Summary for Client Team
- Items 1, 3, 4: Non-issues. Server behavior is correct.
- Items 2, 5: Valid. Refresh token is a per-user singleton — multi-device refresh conflicts are real. Server-side fix needed.

---

## Review: SRVREQ-member-list-ban-filter (P2)

**Status: Corrected** — The request is accurate and the fix is valid. Minor corrections provided.

### 1. Ban Exclusion in `findByServerId` — CONFIRMED NEEDED
- The query at [db.ts:339-361](packages/api/src/lib/db.ts#L339-L361) has **no ban filtering whatsoever**.
- The suggested `WHERE NOT EXISTS (SELECT 1 FROM bans ...)` approach is correct.
- Indexes `idx_bans_server` and `idx_bans_user` exist and will keep this efficient.
- **Approved as-is.** Implement the `NOT EXISTS` subquery.

### 2. Cleanup of Orphaned Member Rows — LOWER PRIORITY THAN STATED
- `handleMemberLeave()` at [server.ts:464-516](packages/api/src/services/server.ts#L464-L516) runs inside a `sql.begin()` **transaction** and performs `DELETE FROM members` reliably.
- The ban handler at [servers.ts:873](packages/api/src/routes/servers.ts#L873) calls `handleMemberLeave()` before inserting the ban.
- **In normal operation, orphaned rows should not occur** — the transaction ensures atomicity.
- The belt-and-suspenders `DELETE` is unnecessary given the transaction, but the `NOT EXISTS` filter in change #1 serves as the real safety net anyway.
- **Minor correction:** The client's concern about `handleMemberLeave()` failing silently is unfounded — it's transactional. However, change #1 alone is sufficient defense.

### 3. Line Number Corrections
- The client references line numbers that may have drifted. Verify current line numbers before implementing.

### Implementation Recommendation
- Implement change #1 (the `NOT EXISTS` subquery) — simple, safe, effective.
- Skip change #2 (explicit DELETE after ban) — redundant given the existing transaction.

---

## Review: SRVREQ-noise-cancellation-mode (P3)

**Status: Modified** — Implemented with the requested field names. One additional mode added for web browser users.

### 1. Field Names — ACCEPTED AS REQUESTED
- DB column: `noise_cancellation_mode VARCHAR(16) DEFAULT 'off'`
- DB column: `ns_aggressiveness REAL DEFAULT 0.5 CHECK (>= 0.0 AND <= 1.0)`
- Both accepted and returned by `PATCH /api/users/me/settings` and `GET /api/users/me/settings`

### 2. Valid Modes — MODIFIED (one addition)
- Client requested: `'off' | 'nsnet2' | 'deepfilter'`
- Server accepts: **`'off' | 'native' | 'nsnet2' | 'deepfilter'`**
- **`'native'` was added** for web browser users (browser built-in noise suppression). The desktop client does not need to send this value — it's web-only. If the desktop client encounters `'native'` when reading settings, treat it as equivalent to `'off'` for desktop purposes (no client-side processing needed; the browser handles it).

### 3. Validation — IMPLEMENTED
- `noise_cancellation_mode` validated against the 4-value allowlist; returns 400 on invalid
- `ns_aggressiveness` validated as number in [0.0, 1.0]; returns 400 on out-of-range

### 4. Legacy Boolean Sync — IMPLEMENTED
- `ai_noise_suppression` column is **kept** for backward compat as requested
- When `noise_cancellation_mode` is written via PATCH, server auto-syncs:
  - `'off'` → `audio_noise_suppression=false`, `audio_ai_noise_suppression=false`
  - `'native'` → `audio_noise_suppression=true`, `audio_ai_noise_suppression=false`
  - `'nsnet2'` → `audio_noise_suppression=true`, `audio_ai_noise_suppression=true`
  - `'deepfilter'` → `audio_noise_suppression=true`, `audio_ai_noise_suppression=true`

### 5. Migration — READY
- Migration file: `packages/api/src/migrations/036_noise_suppression_mode.sql`
- Backfills existing rows from legacy booleans: `ai_noise_suppression=true` → `'nsnet2'`, `audio_noise_suppression=true` → `'native'`, else `'off'`

### 6. Bonus: Web Client Implementation
- Server team also built the web client side: RNNoise WASM AudioWorklet pipeline, NoiseModeSelector UI, voiceSettingsStore. Web users now get `Off | Standard (native) | AI Enhanced (nsnet2)` in Voice Settings.

### Summary for Client Team
- **Use `noise_cancellation_mode` and `ns_aggressiveness`** as your SYNCABLE_KEYS — exact match.
- **`'native'` is a new valid value** the desktop client may read back from settings. Treat it as `'off'` on desktop (it means "let the browser handle it").
- **Default for new users is `'off'`** — matching your request.
- **Legacy `ai_noise_suppression` boolean still works** — old client versions won't break.
