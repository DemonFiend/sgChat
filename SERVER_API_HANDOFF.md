# sgChat Server API Handoff

This document outlines the API changes and new endpoints required for the sgChat client to function properly.

---

## URGENT FIXES (Blocking Login)

### 1. Fix `/health` Endpoint

**Current response:**
```json
{"status":"ok","timestamp":"2026-01-24T02:25:05.154Z"}
```

**Required response:**
```json
{
  "status": "ok",
  "name": "sgChat Server",
  "version": "1.0.0",
  "timestamp": "2026-01-24T02:25:05.154Z"
}
```

The client displays "Unknown Server vUnknown" because these fields are missing.

### 2. Fix `/auth/login` Validation

**Current error:**
```json
[{"code":"invalid_type","expected":"string","received":"undefined","path":["username"],"message":"Required"}]
```

**Problem:** The login endpoint is validating for `username` but login should only require `email` + `password`.

**Fix the Zod schema:**
```typescript
// WRONG - current
const loginSchema = z.object({
  email: z.string().email(),
  username: z.string(),  // ❌ Remove this
  password: z.string()
});

// CORRECT - required
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});
```

**Note:** Username is only required for `/auth/register`, not `/auth/login`. Users authenticate with email.

---

## Architecture Context

sgChat is a **self-hosted chat platform** (like Revolt/Matrix), NOT Discord.

**Key differences:**
- Each sgChat deployment IS a server instance
- Users connect to different instances via "Networks" in the client
- Users do NOT create servers within an instance
- Admins configure channels, roles, permissions server-side
- The client displays settings UI, but ALL changes go through API calls
- **The server enforces permissions** - client cannot bypass security

---

## Permission System

The client needs permission data to show/hide admin features.

### Update `GET /users/me` Response

**Current response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "username": "username",
  "display_name": "Display Name",
  "avatar_url": null,
  "status": "online",
  "custom_status": null,
  "created_at": "2026-01-01T00:00:00Z"
}
```

**Required response (add `roles` and `permissions`):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "username": "username",
  "display_name": "Display Name",
  "avatar_url": null,
  "status": "online",
  "custom_status": null,
  "created_at": "2026-01-01T00:00:00Z",
  "roles": [
    {
      "id": "role-uuid",
      "name": "Admin",
      "color": "#ff0000",
      "position": 100
    }
  ],
  "permissions": {
    "administrator": true,
    "manage_channels": true,
    "manage_roles": true,
    "manage_members": true,
    "kick_members": true,
    "ban_members": true,
    "manage_messages": true,
    "manage_server": true,
    "view_audit_log": true,
    "manage_invites": true
  }
}
```

The `permissions` object is the **computed/effective permissions** based on all the user's roles combined.

### Permission Flags Reference

| Permission | Description |
|------------|-------------|
| `administrator` | Full access, bypasses all checks |
| `manage_server` | Edit server name, icon, description |
| `manage_channels` | Create, edit, delete channels/categories |
| `manage_roles` | Create, edit, delete roles |
| `manage_members` | Change nicknames, assign roles |
| `kick_members` | Remove members from server |
| `ban_members` | Permanently ban members |
| `manage_messages` | Delete any message, pin messages |
| `manage_invites` | Create and delete invite links |
| `view_audit_log` | View the audit log |
| `send_messages` | Send messages in text channels |
| `embed_links` | Links show previews |
| `attach_files` | Upload files and images |
| `add_reactions` | Add emoji reactions |
| `mention_everyone` | Use @everyone and @here |
| `connect` | Connect to voice channels |
| `speak` | Speak in voice channels |
| `video` | Use video in voice channels |
| `mute_members` | Mute others in voice |
| `deafen_members` | Deafen others in voice |
| `move_members` | Move members between voice channels |

---

## User Settings Endpoints

These endpoints allow **all authenticated users** to manage their own account.

### Update User Profile

```
PATCH /users/me
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "display_name": "New Display Name",  // optional
  "avatar_url": "https://...",         // optional (or use upload endpoint)
  "custom_status": "Working",          // optional
  "status": "dnd"                      // optional: online|idle|dnd|invisible
}

Response: 200 OK
{ ...updated user object with roles and permissions... }
```

### Change Password

```
POST /users/me/password
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "current_password": "OldPass123!",
  "new_password": "NewPass456!"
}

Response: 200 OK
{ "message": "Password updated successfully" }

Response: 400 Bad Request
{ "message": "Current password is incorrect" }
```

### Change Email

```
POST /users/me/email
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "new_email": "newemail@example.com",
  "password": "CurrentPass123!"  // require password confirmation
}

Response: 200 OK
{ "message": "Verification email sent to newemail@example.com" }
```

### Upload Avatar

```
POST /users/me/avatar
Authorization: Bearer <access_token>
Content-Type: multipart/form-data

file: <image file>

Response: 200 OK
{
  "avatar_url": "https://minio.example.com/avatars/uuid.webp"
}
```

### Delete Avatar

```
DELETE /users/me/avatar
Authorization: Bearer <access_token>

Response: 200 OK
{ "message": "Avatar removed" }
```

### Get/Update User Preferences

```
GET /users/me/preferences
Authorization: Bearer <access_token>

Response: 200 OK
{
  "theme": "dark",
  "compact_mode": false,
  "notifications_enabled": true,
  "notification_sound": true,
  "dm_notifications": "all",
  "message_display": "cozy"
}

PATCH /users/me/preferences
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "theme": "light",
  "compact_mode": true
}

Response: 200 OK
{ ...updated preferences... }
```

---

## Server Settings Endpoints

These require **administrator or specific permissions**. The server MUST validate permissions.

### Get/Update Server Info

```
GET /server
Authorization: Bearer <access_token>

Response: 200 OK
{
  "id": "server-uuid",
  "name": "My sgChat Server",
  "description": "A cool chat server",
  "icon_url": "https://...",
  "banner_url": "https://...",
  "owner_id": "user-uuid",
  "created_at": "2026-01-01T00:00:00Z",
  "member_count": 150,
  "features": ["voice", "video", "file_uploads"]
}

PATCH /server
Authorization: Bearer <access_token>
Permission: manage_server OR administrator
Content-Type: application/json

{
  "name": "New Server Name",
  "description": "Updated description"
}

Response: 200 OK
{ ...updated server info... }

Response: 403 Forbidden
{ "message": "You do not have permission to manage this server" }
```

---

## Roles Endpoints

**Permission required:** `manage_roles` or `administrator`

### List Roles

```
GET /roles
Authorization: Bearer <access_token>

Response: 200 OK
[
  {
    "id": "role-uuid",
    "name": "Admin",
    "color": "#ff0000",
    "position": 100,
    "permissions": { "administrator": true, ... },
    "mentionable": true,
    "hoist": true
  }
]
```

### Create Role

```
POST /roles
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "Moderator",
  "color": "#00ff00",
  "permissions": { "manage_messages": true, "kick_members": true },
  "mentionable": true,
  "hoist": true
}

Response: 201 Created
{ ...new role... }
```

### Update Role

```
PATCH /roles/:roleId
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "Senior Moderator",
  "permissions": {...}
}

Response: 200 OK
{ ...updated role... }
```

### Delete Role

```
DELETE /roles/:roleId
Authorization: Bearer <access_token>

Response: 200 OK
{ "message": "Role deleted" }
```

### Reorder Roles

```
PATCH /roles/reorder
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "role_ids": ["role-uuid-1", "role-uuid-2", "role-uuid-3"]
}

Response: 200 OK
{ "message": "Roles reordered" }
```

---

## Members Endpoints

### List Members

```
GET /members
Authorization: Bearer <access_token>
Query: ?limit=100&offset=0&search=username

Response: 200 OK
{
  "members": [
    {
      "user": {
        "id": "user-uuid",
        "username": "johndoe",
        "display_name": "John",
        "avatar_url": "https://...",
        "status": "online"
      },
      "roles": ["role-uuid-1", "role-uuid-2"],
      "joined_at": "2026-01-15T00:00:00Z",
      "nickname": "Johnny"
    }
  ],
  "total": 150
}
```

### Update Member (Assign Roles, Set Nickname)

**Permission:** `manage_members` or `administrator`

```
PATCH /members/:userId
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "roles": ["role-uuid-1", "role-uuid-2"],
  "nickname": "New Nickname"
}

Response: 200 OK
{ ...updated member... }
```

### Kick Member

**Permission:** `kick_members` or `administrator`

```
POST /members/:userId/kick
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "reason": "Violated rules"  // optional, for audit log
}

Response: 200 OK
{ "message": "Member kicked" }
```

### Ban Member

**Permission:** `ban_members` or `administrator`

```
POST /members/:userId/ban
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "reason": "Repeated violations",
  "delete_messages_days": 7
}

Response: 200 OK
{ "message": "Member banned" }
```

---

## Channels Endpoints

**Permission:** `manage_channels` or `administrator`

### Create Channel

```
POST /channels
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "general",
  "type": "text",  // text|voice|announcement
  "category_id": "category-uuid",  // optional
  "topic": "General discussion",   // optional
  "nsfw": false,                   // optional
  "slowmode_seconds": 0,           // optional
  "position": 0                    // optional
}

Response: 201 Created
{ ...new channel... }
```

### Update Channel

```
PATCH /channels/:channelId
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "renamed-channel",
  "topic": "Updated topic"
}

Response: 200 OK
{ ...updated channel... }
```

### Delete Channel

```
DELETE /channels/:channelId
Authorization: Bearer <access_token>

Response: 200 OK
{ "message": "Channel deleted" }
```

### Reorder Channels

```
PATCH /channels/reorder
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "channel_ids": ["ch-1", "ch-2", "ch-3"],
  "category_id": "category-uuid"
}

Response: 200 OK
{ "message": "Channels reordered" }
```

---

## Categories Endpoints

**Permission:** `manage_channels` or `administrator`

### Create Category

```
POST /categories
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "Voice Channels",
  "position": 2
}

Response: 201 Created
{ ...new category... }
```

### Update Category

```
PATCH /categories/:categoryId
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "Renamed Category"
}

Response: 200 OK
{ ...updated category... }
```

### Delete Category

```
DELETE /categories/:categoryId
Authorization: Bearer <access_token>
Query: ?move_channels_to=category-uuid  // optional

Response: 200 OK
{ "message": "Category deleted" }
```

---

## Invites Endpoints

**Permission:** `manage_invites` or `administrator`

### List Invites

```
GET /invites
Authorization: Bearer <access_token>

Response: 200 OK
[
  {
    "code": "abc123",
    "created_by": { "id": "...", "username": "..." },
    "created_at": "2026-01-20T00:00:00Z",
    "expires_at": "2026-01-27T00:00:00Z",
    "max_uses": 100,
    "uses": 45
  }
]
```

### Create Invite

```
POST /invites
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "max_uses": 100,        // optional, null = unlimited
  "expires_in": 604800    // optional, seconds, null = never
}

Response: 201 Created
{
  "code": "abc123",
  "url": "https://chat.sosiagaming.com/invite/abc123",
  ...
}
```

### Delete Invite

```
DELETE /invites/:code
Authorization: Bearer <access_token>

Response: 200 OK
{ "message": "Invite deleted" }
```

### Join via Invite

```
POST /invites/:code/join
Authorization: Bearer <access_token>

Response: 200 OK
{ "message": "Joined server successfully" }

Response: 400 Bad Request
{ "message": "Invite expired or max uses reached" }
```

---

## Bans Endpoints

**Permission:** `ban_members` or `administrator`

### List Bans

```
GET /bans
Authorization: Bearer <access_token>

Response: 200 OK
[
  {
    "user": { "id": "...", "username": "...", "avatar_url": "..." },
    "reason": "Spam",
    "banned_by": { "id": "...", "username": "..." },
    "banned_at": "2026-01-18T00:00:00Z"
  }
]
```

### Unban User

```
DELETE /bans/:userId
Authorization: Bearer <access_token>

Response: 200 OK
{ "message": "User unbanned" }
```

---

## Audit Log Endpoint

**Permission:** `view_audit_log` or `administrator`

```
GET /audit-log
Authorization: Bearer <access_token>
Query: ?limit=50&before=entry-id&user_id=...&action_type=...

Response: 200 OK
{
  "entries": [
    {
      "id": "entry-uuid",
      "action_type": "channel_create",
      "user": { "id": "...", "username": "..." },
      "target": { "type": "channel", "id": "...", "name": "general" },
      "changes": [
        { "key": "name", "old_value": null, "new_value": "general" }
      ],
      "reason": null,
      "created_at": "2026-01-20T12:00:00Z"
    }
  ]
}
```

### Action Types

- `server_update`
- `channel_create`, `channel_update`, `channel_delete`
- `category_create`, `category_update`, `category_delete`
- `role_create`, `role_update`, `role_delete`
- `member_kick`, `member_ban`, `member_unban`
- `member_role_update`
- `invite_create`, `invite_delete`
- `message_delete`, `message_bulk_delete`

---

## Implementation Priority

### Phase 1: URGENT (Blocking Client)
1. ✅ Fix `/health` - add `name` and `version`
2. ✅ Fix `/auth/login` - remove `username` requirement

### Phase 2: User Settings
1. `PATCH /users/me` - update profile
2. `POST /users/me/avatar` - upload avatar  
3. `DELETE /users/me/avatar` - remove avatar
4. `POST /users/me/password` - change password
5. `GET/PATCH /users/me/preferences` - user preferences
6. Update `GET /users/me` to include `roles` and `permissions`

### Phase 3: Server Settings (Admin)
1. `GET /server`, `PATCH /server`
2. Roles CRUD endpoints
3. Members management endpoints

### Phase 4: Channel Management
1. Channels CRUD
2. Categories CRUD
3. Reorder endpoints

### Phase 5: Moderation
1. Kick/Ban endpoints
2. Bans list and unban
3. Invites management
4. Audit log

---

## Test Credentials

- **Email:** test@example.com
- **Password:** TestPass123!
- **Backend URL:** http://192.168.2.23:3040

## Client Info

- **Dev Server:** http://localhost:5174 (or 5175/5176 if ports in use)
- **Vite Proxy:** `/api/*` → `http://192.168.2.23:3040/*`
- **All auth requests use `credentials: 'include'`** for cookie handling
