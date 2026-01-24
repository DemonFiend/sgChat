# sgChat API Update - Single-Tenant Architecture

## Overview
The API has been updated to support a single-tenant architecture where each deployment IS the server. Key changes:

1. **Flat permissions** - `/users/me` now returns flat `roles[]` and `permissions{}` (named booleans) instead of nested servers array
2. **Standalone routes** - New top-level endpoints that don't require server_id in path
3. **New features** - Categories, message reactions, channel read state
4. **Admin claim system** - On first startup, generates a claim code for first admin to take ownership
5. **Server bootstrap** - Auto-creates default channels (#welcome, #general, Voice Channel 1, Away Channel)

---

## Database Migrations Required
Run these SQL statements on the server before deploying the updated API:

```sql
-- Add reply_to_id for message replies
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL;

-- Add new server columns
ALTER TABLE servers ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS motd TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS motd_enabled BOOLEAN DEFAULT false;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'UTC';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS admin_claim_code VARCHAR(64);
ALTER TABLE servers ADD COLUMN IF NOT EXISTS admin_claimed BOOLEAN DEFAULT false;

-- Make owner_id nullable (for unclaimed servers)
ALTER TABLE servers ALTER COLUMN owner_id DROP NOT NULL;

-- Categories table for organizing channels
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Message reactions
CREATE TABLE IF NOT EXISTS message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

-- Channel read state for unread tracking
CREATE TABLE IF NOT EXISTS channel_read_state (
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);

-- Add category_id to channels
ALTER TABLE channels ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_categories_server_id ON categories(server_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_channel_read_state_user_id ON channel_read_state(user_id);
```

---

## Admin Claim System

On first startup (when no server exists), the API:
1. Creates a default server with `owner_id = NULL` (unclaimed)
2. Creates 4 default channels: #welcome, #general, Voice Channel 1, Away Channel (AFK)
3. Creates @everyone role with basic permissions
4. Generates a 32-character admin claim code
5. Logs the claim code to console

**Console output on first startup:**
```
╔══════════════════════════════════════════════════════════════════╗
║                     ADMIN CLAIM CODE                             ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  abc123xyz789...                                                 ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  To claim ownership:                                             ║
║  1. Register an account                                          ║
║  2. POST /auth/claim-admin with { "code": "<code>" }             ║
║  3. You will become the server owner with full permissions       ║
╚══════════════════════════════════════════════════════════════════╝
```

### POST /auth/claim-admin
Claim server ownership with the admin code.

**Request:**
```json
{ "code": "abc123xyz789..." }
```

**Response (success):**
```json
{
  "message": "Server ownership claimed successfully! You are now the administrator.",
  "server": {
    "id": "uuid",
    "name": "sgChat Server",
    "owner_id": "your-user-id"
  }
}
```

**Errors:**
- 404: No server exists yet
- 400: Server already claimed
- 403: Invalid claim code

---

## Updated Endpoints

### GET /users/me
**Response format changed!**

Old (multi-server):
```json
{
  "id": "...",
  "username": "...",
  "servers": [
    {
      "server_id": "...",
      "roles": [...],
      "permissions": { "server": 123, "text": 456, "voice": 789 }
    }
  ]
}
```

New (single-tenant):
```json
{
  "id": "uuid",
  "username": "string",
  "email": "string",
  "avatar_url": "string | null",
  "status": "online | idle | dnd | invisible | offline",
  "created_at": "ISO8601",
  
  // Flat server membership info (for THE server)
  "nickname": "string | null",
  "joined_at": "ISO8601",
  "is_owner": true,
  
  // Roles array (flat, not nested under server)
  "roles": [
    { "id": "uuid", "name": "Admin", "color": "#FF0000", "position": 10 }
  ],
  
  // Named permissions (booleans, not bitmasks!)
  "permissions": {
    "administrator": true,
    "manage_server": true,
    "manage_channels": true,
    "manage_roles": true,
    "kick_members": true,
    "ban_members": true,
    "create_invites": true,
    "change_nickname": true,
    "manage_nicknames": true,
    "view_audit_log": true,
    "view_channel": true,
    "send_messages": true,
    "embed_links": true,
    "attach_files": true,
    "add_reactions": true,
    "mention_everyone": true,
    "manage_messages": true,
    "read_message_history": true,
    "connect": true,
    "speak": true,
    "video": true,
    "stream": true,
    "mute_members": false,
    "deafen_members": false,
    "move_members": false,
    "disconnect_members": false,
    "priority_speaker": false,
    "use_voice_activity": true
  }
}
```

---

## New Endpoints

### Server Info (Single-Tenant)

#### GET /server
Get instance/server information. Settings are only visible to admins.

**Response (for regular users):**
```json
{
  "id": "uuid",
  "name": "Server Name",
  "description": "...",
  "icon_url": "...",
  "banner_url": "...",
  "owner_id": "uuid",
  "member_count": 42,
  "admin_claimed": true,
  "created_at": "ISO8601",
  "features": ["voice", "video", "file_uploads"],
  "motd": "Welcome message (only if motd_enabled)"
}
```

**Response (for admins - includes settings):**
```json
{
  "id": "uuid",
  "name": "Server Name",
  "description": "...",
  "icon_url": "...",
  "banner_url": "...",
  "owner_id": "uuid",
  "member_count": 42,
  "admin_claimed": true,
  "created_at": "ISO8601",
  "features": ["voice", "video", "file_uploads"],
  "motd": "Welcome message",
  "settings": {
    "motd": "Full MOTD text",
    "motd_enabled": true,
    "timezone": "UTC",
    "announce_joins": true,
    "announce_leaves": true,
    "announce_online": false,
    "afk_timeout": 300,
    "welcome_channel_id": "uuid",
    "afk_channel_id": "uuid"
  }
}
```

#### PATCH /server
Update server settings. Requires `ADMINISTRATOR` permission or be server owner.

**Body:**
```json
{
  "name": "string (optional)",
  "description": "string (optional)",
  "icon_url": "string (optional)",
  "banner_url": "string (optional)",
  "motd": "string (optional)",
  "motd_enabled": "boolean (optional)",
  "timezone": "string (optional, e.g. 'America/New_York')",
  "afk_timeout": "number (optional, 60-3600 seconds)",
  "afk_channel_id": "uuid (optional)",
  "welcome_channel_id": "uuid (optional)",
  "announce_joins": "boolean (optional)",
  "announce_leaves": "boolean (optional)",
  "announce_online": "boolean (optional)"
}
```

#### POST /server/transfer-ownership
Transfer server ownership to another member. Only the current owner can do this.

**Body:**
```json
{ "user_id": "uuid of new owner" }
```

**Response:**
```json
{
  "message": "Ownership transferred successfully",
  "new_owner": {
    "id": "uuid",
    "username": "newowner"
  }
}
```

---

### Standalone Routes (No server_id in path)

#### Roles

| Method | Path | Description |
|--------|------|-------------|
| GET | /roles | List all roles |
| POST | /roles | Create role |
| PATCH | /roles/:id | Update role |
| DELETE | /roles/:id | Delete role |
| POST | /roles/reorder | Reorder roles |

**GET /roles Response:**
```json
[
  {
    "id": "uuid",
    "name": "Admin",
    "color": "#FF0000",
    "position": 10,
    "permissions": {
      "administrator": true,
      "manage_server": true,
      // ... all named permissions
    }
  }
]
```

#### Members

| Method | Path | Description |
|--------|------|-------------|
| GET | /members | List members (paginated) |
| PATCH | /members/:userId | Update member |
| DELETE | /members/:userId | Kick member |
| POST | /members/:userId/ban | Ban member |

**GET /members Query Params:**
- `limit` (default: 50, max: 100)
- `offset` (default: 0)  
- `search` (optional string)

**GET /members Response:**
```json
{
  "members": [
    {
      "user_id": "uuid",
      "username": "string",
      "avatar_url": "string | null",
      "status": "online",
      "nickname": "string | null",
      "joined_at": "ISO8601",
      "roles": [{ "id": "uuid", "name": "Admin", "color": "#FF0000" }]
    }
  ],
  "total": 100
}
```

#### Invites

| Method | Path | Description |
|--------|------|-------------|
| GET | /invites | List all invites |
| POST | /invites | Create invite |
| DELETE | /invites/:code | Delete invite |
| POST | /invites/:code/join | Join via invite |

#### Bans

| Method | Path | Description |
|--------|------|-------------|
| GET | /bans | List all bans |
| DELETE | /bans/:userId | Unban user |

#### Audit Log

| Method | Path | Description |
|--------|------|-------------|
| GET | /audit-log | Get audit log entries |

**Query Params:**
- `limit` (default: 50, max: 100)
- `offset` (default: 0)
- `action` (optional filter)
- `user_id` (optional filter)

---

### Categories

| Method | Path | Description |
|--------|------|-------------|
| GET | /categories | List categories |
| POST | /categories | Create category |
| PATCH | /categories/:id | Update category |
| DELETE | /categories/:id | Delete category |
| POST | /categories/reorder | Reorder categories |

**Category Object:**
```json
{
  "id": "uuid",
  "name": "General",
  "position": 0,
  "created_at": "ISO8601"
}
```

---

### File Uploads

#### POST /upload
General file upload (max 10MB).

**Request:** multipart/form-data with file field

**Response:**
```json
{
  "url": "http://...",
  "filename": "original-name.pdf",
  "size": 12345,
  "content_type": "application/pdf"
}
```

#### POST /upload/image
Image-specific upload (max 5MB).

---

### Message Reactions

#### PUT /messages/:id/reactions/:emoji
Add reaction to message.

**Response:**
```json
{
  "reactions": [
    { "emoji": "👍", "count": 5, "me": true }
  ]
}
```

#### DELETE /messages/:id/reactions/:emoji
Remove your reaction.

#### GET /messages/:id/reactions
Get all reactions with user lists.

**Response:**
```json
[
  { "emoji": "👍", "count": 5, "me": true, "user_ids": ["uuid1", "uuid2", ...] }
]
```

---

### Channel Read State

#### POST /channels/:id/ack
Mark channel as read.

**Body (optional):**
```json
{ "message_id": "uuid" }
```

If no message_id, marks all messages as read.

**Response:**
```json
{
  "last_read_message_id": "uuid",
  "unread_count": 0
}
```

#### GET /channels/:id/read-state
Get read state for channel.

**Response:**
```json
{
  "last_read_message_id": "uuid | null",
  "last_read_at": "ISO8601 | null",
  "unread_count": 5
}
```

---

### User Preferences

#### GET /users/me/preferences
Alias for GET /users/me/settings

#### PATCH /users/me/preferences  
Alias for PATCH /users/me/settings

---

## Socket Events

### New Events

| Event | Payload | Description |
|-------|---------|-------------|
| `category:create` | Category object | New category created |
| `category:update` | Category object | Category updated |
| `category:delete` | `{ id }` | Category deleted |
| `categories:reorder` | Category[] | Categories reordered |
| `message:reaction` | `{ message_id, emoji, user_id, action, reactions }` | Reaction added/removed |

---

## Migration Notes for Client

1. **Remove server selection UI** - The client connects to ONE server (the deployment)
2. **Update /users/me parsing** - Roles and permissions are now flat, not nested under servers
3. **Use named permissions** - Check `permissions.send_messages` not `(perms & 0x2) !== 0`
4. **Use standalone routes** - Use `/roles` not `/servers/:id/roles`
5. **Add category support** - Channels can now belong to categories
6. **Add reaction UI** - Use PUT/DELETE /messages/:id/reactions/:emoji
7. **Track read state** - Call POST /channels/:id/ack when user views channel
