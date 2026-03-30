# Server Feature Request: Noise Cancellation Mode Remote Settings

## Context
The desktop client is upgrading from a boolean `ai_noise_suppression` toggle to a multi-mode
noise cancellation pipeline (`off | nsnet2 | deepfilter`) with an aggressiveness slider.
The new settings need to sync to the server via the existing `PATCH /api/users/me/settings`
and `GET /api/users/me/settings` endpoints.

## Requested Changes

### 1. Accept new setting keys in PATCH /api/users/me/settings
- **Route:** `PATCH /api/users/me/settings`
- **Current behavior:** Accepts `ai_noise_suppression` (boolean)
- **Requested behavior:** Also accept `noise_cancellation_mode` (string: 'off' | 'nsnet2' | 'deepfilter') and `ns_aggressiveness` (number: 0.0-1.0)
- **Validation:** `noise_cancellation_mode` must be one of the three valid values; `ns_aggressiveness` must be between 0.0 and 1.0
- **Auth/permissions:** Same as existing — authenticated user updating their own settings

### 2. Return new keys in GET /api/users/me/settings
- **Route:** `GET /api/users/me/settings`
- **Current behavior:** Returns `ai_noise_suppression` (boolean)
- **Requested behavior:** Also return `noise_cancellation_mode` and `ns_aggressiveness`

## Database Impact
```sql
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS noise_cancellation_mode TEXT DEFAULT 'off';
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS ns_aggressiveness REAL DEFAULT 0.5;

-- Migrate existing data
UPDATE user_settings
  SET noise_cancellation_mode = CASE
    WHEN ai_noise_suppression = true THEN 'nsnet2'
    ELSE 'off'
  END
  WHERE noise_cancellation_mode IS NULL OR noise_cancellation_mode = 'off';
```

Keep `ai_noise_suppression` column for backward compatibility with older clients.

## Web UI Impact
- **Breaking changes:** None — additive columns only
- **Web UI benefits:** Web UI can read `noise_cancellation_mode` to show the user's desktop NS preference (informational only, since web doesn't have DeepFilter)
- **Migration notes:** None required for web UI

## Client Files That Will Consume This
- `src/renderer/lib/settingsSync.ts` — `RemoteSettings` interface adds `noise_cancellation_mode` and `ns_aggressiveness`
- `src/renderer/stores/voiceSettingsStore.ts` — `hydrateFromServer()` reads new keys, `SYNCABLE_KEYS` maps to them, `autoPersist()` writes them

## Priority & Blocking
- **Client beads blocked by this:** None directly (client falls back to local-only settings if server doesn't support)
- **Suggested priority:** P3 (non-blocking, but needed for cross-device sync)

## Implementation Hints
- The server's generic settings PATCH handler at `packages/web/src/api/routes/users.ts` likely uses a whitelist of accepted keys. Add the two new keys to that whitelist.
- Follow the same pattern as existing settings columns (same migration pattern, same validation approach).

---

## Server Response (2026-03-29)

**Status: Implemented (Modified)**

### What was implemented exactly as requested
- Column names: `noise_cancellation_mode` and `ns_aggressiveness` — exact match
- Default: `'off'` for new users
- Validation: enum allowlist + 0.0-1.0 range check, returns 400 on invalid
- `ai_noise_suppression` boolean kept for backward compat, auto-synced on write
- `PATCH /api/users/me/settings` and `GET /api/users/me/settings` both support the new fields

### What was modified
- **Added `'native'` as a 4th valid mode** (`'off' | 'native' | 'nsnet2' | 'deepfilter'`). This is for web browser users only (browser built-in noise suppression). **Desktop client action:** If you read back `'native'` from the API, treat it as `'off'` on desktop — it means the user selected browser-level NS from the web UI.

### Client SYNCABLE_KEYS mapping
```typescript
// In settingsSync.ts — these keys match the server DB columns exactly:
SYNCABLE_KEYS: {
  noiseCancellationMode: 'noise_cancellation_mode',  // string: 'off' | 'nsnet2' | 'deepfilter'
  nsAggressiveness: 'ns_aggressiveness',              // number: 0.0 - 1.0
}
```

### Migration
Run before deploying: `packages/api/src/migrations/036_noise_suppression_mode.sql`
