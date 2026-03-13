# sgChat Client API Reference

API contract reference for client developers (Windows/Linux/Mobile). All endpoints are relative to the server base URL. Authentication is via `Authorization: Bearer <token>` header.

> **Standalone endpoints** (no server ID prefix) are used by the web client and should be preferred. Multi-server endpoints under `/servers/:id/...` also exist but require explicit server IDs.

---

## 1. Permissions & Roles

### Permission Model

Permissions use a **bitflag system with BigInt** stored as strings. Three categories:
- `server_permissions` / `server_permissions_deny`
- `text_permissions` / `text_permissions_deny`
- `voice_permissions` / `voice_permissions_deny`

The API converts these to a **named 3-state format** for client consumption:

```json
{
  "permissions": {
    "manage_server": "allow",
    "kick_members": "deny",
    "send_messages": "default"
  }
}
```

States: `"allow"` | `"deny"` | `"default"` (inherits from @everyone)

**Calculation order:** Owner bypass > timeout check > @everyone role > user roles (OR'd) > ADMINISTRATOR bypass > channel overrides

### Endpoints

#### List Roles
```
GET /roles
```
Returns array of roles with `permissions` as named 3-state object. Each role includes `member_count`.

#### Get Single Role
```
GET /roles/:roleId
```
Returns role with named permissions.

#### Create Role
```
POST /roles
Body: { name: string, color?: string, server_permissions?: string, text_permissions?: string, voice_permissions?: string }
```
Returns created role with named permissions.

#### Update Role
```
PATCH /roles/:roleId
Body: {
  name?: string,
  color?: string | null,
  permissions?: Record<string, "allow" | "deny" | "default">,
  is_hoisted?: boolean,
  is_mentionable?: boolean
}
```
The `permissions` field accepts named 3-state format. The API converts it to bitfields internally. Returns updated role with named permissions.

#### Delete Role
```
DELETE /roles/:roleId
```
Cannot delete @everyone.

#### Reorder Roles
```
PATCH /roles/reorder
Body: { role_ids: string[] }
```
Order determines position (index 0 = highest).

#### Assign Roles to Member
```
PATCH /members/:userId
Body: { roles: string[] }
```
Replaces all member roles with the provided list (role IDs, excluding @everyone).

### Role Templates

```
POST /servers/:id/roles/from-template
Body: { template: "ADMIN" | "MODERATOR" | "MEMBER" | "MUTED" | "GUEST" }
```

---

## 2. Member Moderation

#### Kick Member
```
POST /members/:userId/kick
Body: { reason?: string }
```

#### Ban Member
```
POST /members/:userId/ban
Body: { reason?: string }
```

#### Timeout Member
```
POST /members/:userId/timeout
Body: { duration: number, reason?: string }
```
Duration in seconds (1–2419200, i.e., up to 28 days).

#### Remove Timeout
```
DELETE /members/:userId/timeout
```

#### List Members
```
GET /members?limit=100&offset=0&search=query
```
Returns `{ members: [...], total: number }`. Each member includes:
```json
{
  "id": "uuid",
  "username": "name",
  "display_name": "nickname or username",
  "avatar_url": "...",
  "status": "online|idle|dnd|offline",
  "roles": [{ "id": "...", "name": "...", "color": "#hex", "position": 0 }],
  "joined_at": "ISO date",
  "timeout_until": "ISO date or null"
}
```

---

## 3. Storage Dashboard

All storage endpoints require `ADMINISTRATOR` permission.

#### Get Dashboard
```
GET /server/storage/dashboard
```
Returns comprehensive stats: channels, DMs, emojis, stickers, profiles, uploads, archives, exports, system data. Each category includes `count`, `size_bytes`, and sub-categories.

#### Get/Update Limits
```
GET /server/storage/limits
PATCH /server/storage/limits
Body: { messages_mb?: number, attachments_mb?: number, emojis_mb?: number, ... }
```

#### Purge Storage
```
POST /server/storage/purge
Body: {
  category: "messages" | "attachments" | "emojis" | "stickers" | "profiles" | "archives",
  percent?: number,
  older_than_days?: number,
  dry_run?: boolean
}
```
Returns `{ items_affected: number, bytes_freed: number }`. Use `dry_run: true` to preview.

#### Check Thresholds
```
GET /server/storage/thresholds
```
Returns channels approaching storage limits.

#### Get/Update Retention Settings
```
GET /server/settings/retention
PATCH /server/settings/retention
Body: { default_channel_size_mb?: number, warning_threshold_percent?: number, action_threshold_percent?: number }
```

#### Run Manual Cleanup
```
POST /server/cleanup/run
Body: { dry_run?: boolean }
```

#### Get Cleanup Logs
```
GET /server/cleanup/logs
```

---

## 4. Events / Event History

#### List Events (by month)
```
GET /servers/:serverId/events?month=YYYY-MM
```
Returns events for the specified month. Excludes cancelled events by default.

#### List Events Including Cancelled
```
GET /servers/:serverId/events/history?month=YYYY-MM
```

#### Create Event
```
POST /servers/:serverId/events
Body: {
  title: string,
  description?: string,
  start_time: "ISO datetime",
  end_time: "ISO datetime",
  announcement_channel_id?: string,
  is_public?: boolean,
  visible_role_ids?: string[],
  announce_at_start?: boolean
}
```
Requires `CREATE_EVENTS` permission.

#### Update Event
```
PATCH /servers/:serverId/events/:eventId
Body: { title?, description?, start_time?, end_time?, ... }
```
Requires `MANAGE_EVENTS` or event creator.

#### Cancel Event
```
POST /servers/:serverId/events/:eventId/cancel
```
Soft-cancel (event remains visible in history view).

#### Delete Event
```
DELETE /servers/:serverId/events/:eventId
```
Soft-delete (hidden from all views).

#### RSVP
```
PUT /servers/:serverId/events/:eventId/rsvp
Body: { status: "interested" | "tentative" | "not_interested" }
```
Requires `RSVP_EVENTS` permission.

### Event Object
```json
{
  "id": "uuid",
  "title": "Event Name",
  "description": "...",
  "start_time": "ISO datetime",
  "end_time": "ISO datetime",
  "status": "scheduled | cancelled | deleted",
  "is_public": true,
  "visible_role_ids": [],
  "creator": { "id": "...", "username": "..." },
  "rsvp_counts": { "interested": 5, "tentative": 2, "not_interested": 1 },
  "user_rsvp": "interested"
}
```

---

## 5. Audit Log

#### Query Audit Log
```
GET /audit-log?action_type=role_update&user_id=uuid&limit=50&before=ISO_date
```
All query params optional. Returns `{ entries: [...] }`.

#### Entry Object
```json
{
  "id": "uuid",
  "action": "role_update",
  "user": { "id": "uuid", "username": "name", "avatar_url": "..." },
  "target_type": "role",
  "target_id": "uuid",
  "target_name": "Admin",
  "changes": { ... },
  "reason": "optional reason text",
  "created_at": "ISO datetime"
}
```

### Changes Field Shapes

The `changes` field varies by action type:

| Action Pattern | Shape | Example |
|---|---|---|
| `*_update` | `{ old: {...}, new: {...} }` | `{ old: { name: "A" }, new: { name: "B" } }` |
| `*_create` | `{ created: {...} }` | `{ created: { name: "NewRole", ... } }` |
| `*_delete` | `{ deleted: {...} }` | `{ deleted: { name: "OldRole", ... } }` |
| `member_timeout` | `{ duration: 3600 }` | Duration in seconds |
| Other | Varies | May be null or freeform JSON |

### Action Types
`server_update`, `channel_create`, `channel_update`, `channel_delete`, `role_create`, `role_update`, `role_delete`, `member_kick`, `member_ban`, `member_unban`, `member_timeout`, `member_timeout_remove`, `invite_create`, `invite_delete`, `message_delete`, `ownership_transferred`, `category_create`, `category_update`, `category_delete`, `storage_purge`, `storage_settings_update`

Requires `VIEW_AUDIT_LOG` permission.

---

## 6. Relay Servers

### Public Endpoints (any authenticated user)

#### List Trusted Relays
```
GET /relays
```
Returns relays with health status. Used by clients for voice channel region selection.

#### Report Latency
```
POST /relays/ping-report
Body: { measurements: [{ relay_id: string, latency_ms: number }] }
```
Clients should ping relay health URLs every 5 minutes and report results. Used for auto-routing.

### Admin Endpoints (requires ADMINISTRATOR)

#### Create Relay
```
POST /admin/relays
Body: { name: string, region: string, max_participants?: number, allow_master_fallback?: boolean }
```
Returns `{ pairing_token: string }` (expires 24h, single-use).

#### List All Relays
```
GET /admin/relays
```
Returns `{ relays: [...] }` with all statuses.

#### Suspend Relay
```
POST /admin/relays/:id/suspend
```
Prevents new voice joins. Existing connections stay.

#### Drain Relay
```
POST /admin/relays/:id/drain
```
Graceful shutdown: no new joins, waits for all users to leave, then transitions to offline.

#### Regenerate Pairing Token
```
POST /admin/relays/:id/regenerate
```
Returns new `{ pairing_token: string }`. Use to re-pair suspended relays.

#### Delete Relay
```
DELETE /admin/relays/:id
```

### Relay Object
```json
{
  "id": "uuid",
  "name": "EU West Relay",
  "region": "eu-west",
  "status": "pending | trusted | suspended | draining | offline",
  "last_health_status": "healthy | degraded | unreachable",
  "current_participants": 12,
  "max_participants": 100,
  "livekit_url": "wss://..."
}
```

### Regions
`us-east`, `us-west`, `us-central`, `eu-west`, `eu-central`, `eu-north`, `asia-east`, `asia-southeast`, `asia-south`, `oceania`, `south-america`, `africa`

### Channel Voice Relay Policy
Channels with voice have:
- `voice_relay_policy`: `"master"` | `"auto"` | `"specific"`
- `preferred_relay_id`: UUID (when policy is `"specific"`)

Set via channel settings:
```
PATCH /channels/:id
Body: { voice_relay_policy: "auto", preferred_relay_id: null }
```

### Relay Pairing Flow
1. Admin creates relay via API, gets pairing token
2. Relay operator configures relay with token + master URL
3. Relay calls `POST /internal/relay/pair` with ECDH public key
4. Master validates token, completes key exchange, issues trust certificate
5. Relay status changes from `pending` to `trusted`
6. Relay begins sending heartbeats every 15s
