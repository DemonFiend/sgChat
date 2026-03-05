# Server Changes — Updated for Desktop Client

## 1. Members Endpoint — Now Includes Roles

**Endpoint:** `GET /api/servers/:id/members`

Each member now includes a `roles` array. Members with no roles get `[]`.

**Response format:**
```json
[
  {
    "user_id": "uuid",
    "server_id": "uuid",
    "nickname": "Johnny",
    "announce_online": false,
    "joined_at": "2026-01-15T...",
    "username": "john",
    "display_name": "John",
    "avatar_url": "https://...",
    "status": "online",
    "custom_status": "Playing games",
    "roles": [
      {
        "id": "role-uuid",
        "name": "Moderator",
        "color": "#ff6b6b",
        "position": 5,
        "is_hoisted": true
      }
    ]
  }
]
```

## 2. Server Settings — New `temp_channel_timeout` Field

**GET /api/server** — Admin `settings` object now includes:
```json
{
  "settings": {
    "temp_channel_timeout": 900,
    ...existing fields...
  }
}
```

**PATCH /api/server** — Accepts `temp_channel_timeout` (integer, 30–86400 seconds, default 900 = 15 minutes). Controls how long an empty temp voice channel waits before being auto-deleted.

## 3. Force Disconnect — Behavior Change

`POST /api/voice/disconnect-member` now performs server-side cleanup:
- The server removes the user from Redis voice state and publishes `voice.leave` **before** sending `voice.force_disconnect`.
- **Client no longer needs to emit `voice:leave`** after receiving `voice.force_disconnect` — the server handles it.
- Client should still clean up its local voice state (disconnect from LiveKit, update UI) upon receiving the event.
