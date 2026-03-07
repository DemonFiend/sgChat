-- sgChat Database Schema
-- PostgreSQL 16+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT UNIQUE NOT NULL CHECK (length(username) >= 2 AND length(username) <= 32),
  display_name TEXT CHECK (length(display_name) <= 64),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  banner_url TEXT,
  banner_file_size INTEGER,
  bio TEXT CHECK (length(bio) <= 500),

  -- Status
  status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'idle', 'dnd', 'offline')),
  custom_status TEXT CHECK (length(custom_status) <= 128),
  custom_status_emoji TEXT CHECK (length(custom_status_emoji) <= 10),
  status_expires_at TIMESTAMPTZ,
  
  -- Push notifications
  push_token TEXT,
  push_enabled BOOLEAN DEFAULT true,
  
  -- Activity tracking
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Rich presence / activity
  activity JSONB DEFAULT NULL,
  activity_updated_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status) WHERE status != 'offline';

-- System user (well-known UUID for seeding reactions, system messages, etc.)
INSERT INTO users (id, username, email, password_hash, display_name, status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'System',
  'system@localhost',
  '!disabled',
  'System',
  'offline'
) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- SERVERS
-- ============================================================

CREATE TABLE servers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 100),
  description TEXT CHECK (length(description) <= 500),
  icon_url TEXT,
  banner_url TEXT,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL = unclaimed server
  
  -- Special channels
  welcome_channel_id UUID, -- Set after channels are created
  afk_channel_id UUID,
  
  -- AFK settings
  afk_timeout INTEGER DEFAULT 300 CHECK (afk_timeout > 0), -- seconds

  -- Temp voice channel settings
  temp_channel_timeout INTEGER DEFAULT 900 CHECK (temp_channel_timeout >= 30 AND temp_channel_timeout <= 86400), -- seconds before empty temp channels are deleted

  -- Server settings
  motd TEXT CHECK (length(motd) <= 2000), -- Message of the day
  motd_enabled BOOLEAN DEFAULT false,
  welcome_message TEXT CHECK (length(welcome_message) <= 2000), -- Welcome message for new members
  timezone VARCHAR(50) DEFAULT 'UTC',
  
  -- Popup configuration (admin-editable)
  popup_config JSONB DEFAULT jsonb_build_object(
    'timeFormat', '24h',
    'events', '[]'::jsonb
  ),
  
  -- Admin claim system (for single-tenant bootstrap)
  admin_claim_code VARCHAR(64),
  admin_claimed BOOLEAN DEFAULT false,
  
  -- Announcement settings
  announce_joins BOOLEAN DEFAULT true,
  announce_leaves BOOLEAN DEFAULT true,
  announce_online BOOLEAN DEFAULT false,

  -- Emoji packs master toggle
  emoji_packs_enabled BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_servers_owner ON servers(owner_id);

-- ============================================================
-- CHANNELS
-- ============================================================

CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 100),
  type TEXT NOT NULL CHECK (type IN ('text', 'voice', 'announcement', 'music', 'temp_voice_generator', 'temp_voice')),
  topic TEXT CHECK (length(topic) <= 1024),
  position INTEGER DEFAULT 0,
  
  -- Voice settings
  bitrate INTEGER DEFAULT 64000 CHECK (bitrate >= 8000 AND bitrate <= 384000),
  user_limit INTEGER DEFAULT 0 CHECK (user_limit >= 0 AND user_limit <= 99),
  is_afk_channel BOOLEAN DEFAULT false,
  
  -- Temp voice channel settings
  is_temp_channel BOOLEAN DEFAULT false,
  temp_channel_owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  temp_channel_created_at TIMESTAMPTZ,
  temp_channel_last_empty_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_channels_server ON channels(server_id, position);
CREATE INDEX idx_channels_type ON channels(server_id, type);
CREATE INDEX idx_channels_temp_cleanup ON channels(temp_channel_last_empty_at) 
  WHERE is_temp_channel = true AND temp_channel_last_empty_at IS NOT NULL;

-- Add foreign key constraints for server's special channels
ALTER TABLE servers 
  ADD CONSTRAINT fk_welcome_channel 
  FOREIGN KEY (welcome_channel_id) REFERENCES channels(id) ON DELETE SET NULL;

ALTER TABLE servers 
  ADD CONSTRAINT fk_afk_channel 
  FOREIGN KEY (afk_channel_id) REFERENCES channels(id) ON DELETE SET NULL;

-- ============================================================
-- DIRECT MESSAGE CHANNELS
-- ============================================================

CREATE TABLE dm_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure users are ordered consistently
  CONSTRAINT dm_channels_user_order CHECK (user1_id < user2_id),
  CONSTRAINT dm_channels_unique UNIQUE (user1_id, user2_id)
);

CREATE INDEX idx_dm_channels_user1 ON dm_channels(user1_id);
CREATE INDEX idx_dm_channels_user2 ON dm_channels(user2_id);

-- ============================================================
-- MESSAGES
-- ============================================================

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Target (either channel or DM, not both)
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  dm_channel_id UUID REFERENCES dm_channels(id) ON DELETE CASCADE,
  
  -- Author (null for system messages)
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Content
  content TEXT NOT NULL CHECK (length(content) >= 1 AND length(content) <= 2000),
  attachments JSONB DEFAULT '[]',
  
  -- Status tracking
  status TEXT DEFAULT 'sent' CHECK (status IN ('sending', 'sent', 'received', 'failed')),
  queued_at TIMESTAMPTZ, -- Original compose time (if offline)
  sent_at TIMESTAMPTZ DEFAULT NOW(), -- Server receipt time
  received_at TIMESTAMPTZ, -- Recipient ACK time
  
  -- System events
  system_event JSONB, -- { type, user_id, username, timestamp }
  
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- TTS flag
  is_tts BOOLEAN DEFAULT false,

  -- Full-text search
  search_vector tsvector,

  -- Either channel or DM, not both
  CONSTRAINT message_target CHECK (
    (channel_id IS NOT NULL AND dm_channel_id IS NULL) OR
    (channel_id IS NULL AND dm_channel_id IS NOT NULL)
  )
);

CREATE INDEX idx_messages_channel ON messages(channel_id, created_at DESC) WHERE channel_id IS NOT NULL;
CREATE INDEX idx_messages_dm ON messages(dm_channel_id, created_at DESC) WHERE dm_channel_id IS NOT NULL;
CREATE INDEX idx_messages_author ON messages(author_id);
CREATE INDEX idx_messages_pending ON messages(dm_channel_id, status) WHERE status = 'sent';
CREATE INDEX idx_messages_search ON messages USING GIN(search_vector);

-- Auto-update search vector on message insert/update
CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_messages_search_vector
  BEFORE INSERT OR UPDATE OF content ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_search_vector_update();

-- ============================================================
-- MEMBERS (Server Membership)
-- ============================================================

CREATE TABLE members (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  nickname TEXT CHECK (length(nickname) <= 32),
  announce_online BOOLEAN DEFAULT false,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  
  PRIMARY KEY (user_id, server_id)
);

CREATE INDEX idx_members_server ON members(server_id);
CREATE INDEX idx_members_user ON members(user_id);

-- ============================================================
-- ROLES
-- ============================================================

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 100),
  color TEXT CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  position INTEGER DEFAULT 0,
  
  -- Permissions (bigint stored as text)
  server_permissions TEXT DEFAULT '0',
  text_permissions TEXT DEFAULT '0',
  voice_permissions TEXT DEFAULT '0',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (server_id, name)
);

CREATE INDEX idx_roles_server ON roles(server_id, position DESC);

-- ============================================================
-- MEMBER ROLES
-- ============================================================

CREATE TABLE member_roles (
  member_user_id UUID NOT NULL,
  member_server_id UUID NOT NULL,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  
  PRIMARY KEY (member_user_id, member_server_id, role_id),
  FOREIGN KEY (member_user_id, member_server_id) 
    REFERENCES members(user_id, server_id) ON DELETE CASCADE
);

CREATE INDEX idx_member_roles_role ON member_roles(role_id);

-- ============================================================
-- CHANNEL PERMISSION OVERRIDES
-- ============================================================

CREATE TABLE channel_permission_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  
  -- Either role or user, not both
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  
  -- Permission modifications (bigint stored as text)
  text_allow TEXT DEFAULT '0',
  text_deny TEXT DEFAULT '0',
  voice_allow TEXT DEFAULT '0',
  voice_deny TEXT DEFAULT '0',
  
  CONSTRAINT override_target CHECK (
    (role_id IS NOT NULL AND user_id IS NULL) OR
    (role_id IS NULL AND user_id IS NOT NULL)
  ),
  
  UNIQUE (channel_id, role_id),
  UNIQUE (channel_id, user_id)
);

CREATE INDEX idx_overrides_channel ON channel_permission_overrides(channel_id);
CREATE INDEX idx_overrides_role ON channel_permission_overrides(role_id) WHERE role_id IS NOT NULL;
CREATE INDEX idx_overrides_user ON channel_permission_overrides(user_id) WHERE user_id IS NOT NULL;

-- ============================================================
-- INVITES
-- ============================================================

CREATE TABLE invites (
  code TEXT PRIMARY KEY CHECK (length(code) >= 6 AND length(code) <= 16),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  uses INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CHECK (uses <= COALESCE(max_uses, uses))
);

CREATE INDEX idx_invites_server ON invites(server_id);
CREATE INDEX idx_invites_creator ON invites(creator_id);
CREATE INDEX idx_invites_expires ON invites(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================
-- BANS
-- ============================================================

CREATE TABLE bans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moderator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT CHECK (length(reason) <= 512),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (server_id, user_id)
);

CREATE INDEX idx_bans_server ON bans(server_id);
CREATE INDEX idx_bans_user ON bans(user_id);

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Actor
  action TEXT NOT NULL CHECK (action IN (
    'server_update', 'channel_create', 'channel_update', 'channel_delete',
    'role_create', 'role_update', 'role_delete',
    'member_kick', 'member_ban', 'member_unban',
    'invite_create', 'invite_delete',
    'admin_claimed', 'ownership_transferred',
    'category_create', 'category_update', 'category_delete'
  )),
  target_type TEXT CHECK (target_type IN ('server', 'channel', 'role', 'member', 'invite')),
  target_id TEXT, -- UUID as text for flexibility
  changes JSONB DEFAULT '{}', -- Before/after values
  reason TEXT CHECK (length(reason) <= 512),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_server ON audit_log(server_id, created_at DESC);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_action ON audit_log(server_id, action);

-- ============================================================
-- USER SETTINGS
-- ============================================================

CREATE TABLE user_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  
  -- Theme
  theme_id TEXT DEFAULT 'dark',
  theme_variables JSONB DEFAULT '{}',
  accent_color TEXT DEFAULT '#5865f2',
  font_size INTEGER DEFAULT 14 CHECK (font_size >= 10 AND font_size <= 24),
  chat_density TEXT DEFAULT 'cozy' CHECK (chat_density IN ('compact', 'cozy', 'comfortable')),
  saturation INTEGER DEFAULT 100 CHECK (saturation >= 0 AND saturation <= 200),
  custom_css TEXT CHECK (length(custom_css) <= 50000),
  
  -- Privacy
  hide_online_announcements BOOLEAN DEFAULT true,
  timezone VARCHAR(50) DEFAULT NULL,                              -- User's IANA timezone (e.g., "America/New_York")
  timezone_public BOOLEAN DEFAULT false,                          -- Whether to show timezone publicly to friends
  timezone_dst_enabled BOOLEAN DEFAULT true,                      -- Whether to apply daylight saving time adjustments
  
  -- Voice & Audio Settings (A8-A11)
  audio_input_device_id TEXT,                                     -- Selected microphone device ID
  audio_output_device_id TEXT,                                    -- Selected speaker device ID
  audio_input_volume INTEGER DEFAULT 100 CHECK (audio_input_volume >= 0 AND audio_input_volume <= 200),
  audio_output_volume INTEGER DEFAULT 100 CHECK (audio_output_volume >= 0 AND audio_output_volume <= 200),
  audio_input_sensitivity INTEGER DEFAULT 50 CHECK (audio_input_sensitivity >= 0 AND audio_input_sensitivity <= 100),
  audio_auto_gain_control BOOLEAN DEFAULT true,
  audio_echo_cancellation BOOLEAN DEFAULT true,
  audio_noise_suppression BOOLEAN DEFAULT true,
  voice_activity_detection BOOLEAN DEFAULT true,                  -- VAD vs push-to-talk
  push_to_talk_key TEXT,                                          -- Key binding for PTT
  
  -- Notification Sounds
  enable_sounds BOOLEAN DEFAULT true,
  enable_voice_join_sounds BOOLEAN DEFAULT true,

  -- Desktop keybinds
  keybinds JSONB DEFAULT '{}',

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DM READ STATE
-- ============================================================

CREATE TABLE dm_read_state (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dm_channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
  last_read_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  
  PRIMARY KEY (user_id, dm_channel_id)
);

CREATE INDEX idx_dm_read_state_user ON dm_read_state(user_id);

-- ============================================================
-- PASSWORD RESET TOKENS (A12)
-- ============================================================

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,                                       -- Hashed token (never store plaintext)
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,                                            -- Set when token is consumed
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_password_reset_user ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_expires ON password_reset_tokens(expires_at) WHERE used_at IS NULL;

-- ============================================================
-- INSTANCE SETTINGS
-- ============================================================

CREATE TABLE instance_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default permissions
INSERT INTO instance_settings (key, value) VALUES (
  'default_everyone_permissions',
  '{
    "server": "192",
    "text": "255",
    "voice": "515"
  }'::jsonb
);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for user_settings
CREATE TRIGGER update_user_settings_updated_at 
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger for instance_settings
CREATE TRIGGER update_instance_settings_updated_at 
  BEFORE UPDATE ON instance_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to clean up expired invites (run periodically)
CREATE OR REPLACE FUNCTION clean_expired_invites()
RETURNS void AS $$
BEGIN
  DELETE FROM invites 
  WHERE expires_at IS NOT NULL AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired custom statuses (run periodically)
CREATE OR REPLACE FUNCTION clean_expired_statuses()
RETURNS void AS $$
BEGIN
  UPDATE users 
  SET custom_status = NULL,
      custom_status_emoji = NULL,
      status_expires_at = NULL
  WHERE status_expires_at IS NOT NULL AND status_expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FRIENDSHIPS
-- ============================================================

CREATE TABLE friendships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Ensure user1_id < user2_id to prevent duplicates
  CONSTRAINT friendship_order CHECK (user1_id < user2_id),
  UNIQUE(user1_id, user2_id)
);

CREATE INDEX idx_friendships_user1 ON friendships(user1_id);
CREATE INDEX idx_friendships_user2 ON friendships(user2_id);

-- ============================================================
-- FRIEND REQUESTS
-- ============================================================

CREATE TABLE friend_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_user_id, to_user_id)
);

CREATE INDEX idx_friend_requests_to ON friend_requests(to_user_id);
CREATE INDEX idx_friend_requests_from ON friend_requests(from_user_id);

-- ============================================================
-- BLOCKED USERS
-- ============================================================

CREATE TABLE blocked_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT blocked_not_self CHECK (blocker_id != blocked_id),
  UNIQUE(blocker_id, blocked_id)
);

CREATE INDEX idx_blocked_users_blocker ON blocked_users(blocker_id);
CREATE INDEX idx_blocked_users_blocked ON blocked_users(blocked_id);

-- ============================================================
-- PINNED MESSAGES
-- ============================================================

CREATE TABLE pinned_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  pinned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id, message_id)
);

CREATE INDEX idx_pinned_messages_channel ON pinned_messages(channel_id, pinned_at DESC);
CREATE INDEX idx_pinned_messages_message ON pinned_messages(message_id);

-- ============================================================
-- INVITE USAGE TRACKING
-- ============================================================

CREATE TABLE invite_uses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invite_code TEXT NOT NULL REFERENCES invites(code) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(invite_code, user_id)
);

CREATE INDEX idx_invite_uses_code ON invite_uses(invite_code);
CREATE INDEX idx_invite_uses_user ON invite_uses(user_id);

-- ============================================================
-- ADDITIONAL SCHEMA (Added for single-tenant upgrade)
-- ============================================================

-- Add reply_to_id for message threading (was missing)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

-- ============================================================
-- CATEGORIES
-- ============================================================

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 100),
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_server ON categories(server_id, position);

-- Add category_id to channels
ALTER TABLE channels ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;


-- ============================================================
-- CHANNEL READ STATE (for unread tracking)
-- ============================================================

CREATE TABLE IF NOT EXISTS channel_read_state (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_read_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  mention_count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_read_user ON channel_read_state(user_id);

-- ============================================================
-- NOTIFICATIONS (A4: Live Notifications Core)
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'mention', 'reaction', 'role_change', 'invite',
    'announcement', 'friend_request', 'friend_accept',
    'dm_message', 'system'
  )),
  data JSONB NOT NULL DEFAULT '{}',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(user_id, type);

-- Add notification preferences to user_settings
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notification_sounds BOOLEAN DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notification_toasts BOOLEAN DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notification_dnd_override BOOLEAN DEFAULT false;

-- ============================================================
-- ENHANCED ROLE-BASED PERMISSIONS SYSTEM
-- ============================================================

-- Add new role metadata fields
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_hoisted BOOLEAN DEFAULT false;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_mentionable BOOLEAN DEFAULT false;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_managed BOOLEAN DEFAULT false;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS description TEXT CHECK (length(description) <= 256);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS icon_url TEXT;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS unicode_emoji TEXT CHECK (length(unicode_emoji) <= 32);

-- Add server_permissions to channel_permission_overrides for category-inherited permissions
ALTER TABLE channel_permission_overrides ADD COLUMN IF NOT EXISTS server_allow TEXT DEFAULT '0';
ALTER TABLE channel_permission_overrides ADD COLUMN IF NOT EXISTS server_deny TEXT DEFAULT '0';

-- ============================================================
-- CATEGORY PERMISSION OVERRIDES
-- ============================================================

CREATE TABLE IF NOT EXISTS category_permission_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  
  -- Either role or user, not both
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  
  -- Permission modifications (bigint stored as text)
  text_allow TEXT DEFAULT '0',
  text_deny TEXT DEFAULT '0',
  voice_allow TEXT DEFAULT '0',
  voice_deny TEXT DEFAULT '0',
  
  CONSTRAINT category_override_target CHECK (
    (role_id IS NOT NULL AND user_id IS NULL) OR
    (role_id IS NULL AND user_id IS NOT NULL)
  ),
  
  UNIQUE (category_id, role_id),
  UNIQUE (category_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cat_overrides_category ON category_permission_overrides(category_id);
CREATE INDEX IF NOT EXISTS idx_cat_overrides_role ON category_permission_overrides(role_id) WHERE role_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cat_overrides_user ON category_permission_overrides(user_id) WHERE user_id IS NOT NULL;

-- ============================================================
-- MEMBER TIMEOUTS
-- ============================================================

ALTER TABLE members ADD COLUMN IF NOT EXISTS timeout_until TIMESTAMPTZ;
ALTER TABLE members ADD COLUMN IF NOT EXISTS timeout_reason TEXT CHECK (length(timeout_reason) <= 512);

-- Index for finding timed-out members
CREATE INDEX IF NOT EXISTS idx_members_timeout ON members(timeout_until) WHERE timeout_until IS NOT NULL;

-- ============================================================
-- CHANNEL SLOWMODE
-- ============================================================

ALTER TABLE channels ADD COLUMN IF NOT EXISTS slowmode_seconds INTEGER DEFAULT 0 CHECK (slowmode_seconds >= 0 AND slowmode_seconds <= 21600);
ALTER TABLE channels ADD COLUMN IF NOT EXISTS nsfw BOOLEAN DEFAULT false;

-- ============================================================
-- ROLE HIERARCHY ENFORCEMENT
-- ============================================================

-- Function to get highest role position for a user in a server
CREATE OR REPLACE FUNCTION get_user_highest_role_position(p_user_id UUID, p_server_id UUID)
RETURNS INTEGER AS $$
DECLARE
  max_position INTEGER;
BEGIN
  SELECT COALESCE(MAX(r.position), 0) INTO max_position
  FROM roles r
  INNER JOIN member_roles mr ON r.id = mr.role_id
  WHERE mr.member_user_id = p_user_id 
    AND mr.member_server_id = p_server_id;
  
  RETURN max_position;
END;
$$ LANGUAGE plpgsql;

-- Function to check if a user can manage a role (their position must be higher)
CREATE OR REPLACE FUNCTION can_manage_role(p_user_id UUID, p_server_id UUID, p_role_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  user_position INTEGER;
  target_position INTEGER;
  is_owner BOOLEAN;
BEGIN
  -- Check if user is server owner
  SELECT (owner_id = p_user_id) INTO is_owner FROM servers WHERE id = p_server_id;
  IF is_owner THEN
    RETURN TRUE;
  END IF;
  
  -- Get positions
  user_position := get_user_highest_role_position(p_user_id, p_server_id);
  SELECT position INTO target_position FROM roles WHERE id = p_role_id;
  
  -- User can only manage roles below their highest role
  RETURN user_position > COALESCE(target_position, 0);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- AUDIT LOG EXTENSIONS
-- ============================================================

-- Add new audit log action types
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
  -- Existing actions
  'server_update', 'channel_create', 'channel_update', 'channel_delete',
  'role_create', 'role_update', 'role_delete',
  'member_kick', 'member_ban', 'member_unban',
  'invite_create', 'invite_delete',
  'admin_claimed', 'ownership_transferred',
  'category_create', 'category_update', 'category_delete',
  -- New actions for enhanced permissions
  'member_timeout', 'member_timeout_remove',
  'member_role_add', 'member_role_remove',
  'channel_permission_update', 'category_permission_update',
  'message_pin', 'message_unpin', 'message_delete',
  'webhook_create', 'webhook_update', 'webhook_delete',
  'emoji_create', 'emoji_update', 'emoji_delete',
  'sticker_create', 'sticker_update', 'sticker_delete',
  'event_create', 'event_update', 'event_delete',
  'thread_create', 'thread_update', 'thread_delete'
));

-- ============================================================
-- UPDATE DEFAULT PERMISSIONS
-- ============================================================

-- Update default permissions to use new bitmask values
-- Note: These values need to match the new permission bit positions
UPDATE instance_settings 
SET value = '{
  "server": "6656",
  "text": "16127",
  "voice": "255"
}'::jsonb,
updated_at = NOW()
WHERE key = 'default_everyone_permissions';

-- ============================================================
-- SYNC CHANNELS TO CATEGORIES
-- ============================================================

-- Add sync_permissions flag to channels to indicate if they inherit from category
ALTER TABLE channels ADD COLUMN IF NOT EXISTS sync_permissions_with_category BOOLEAN DEFAULT true;

-- ============================================================
-- USER AVATARS (Avatar storage with history)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_avatars (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK (slot IN ('current', 'previous')),
  storage_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_user_avatars_user ON user_avatars(user_id);

-- Insert default avatar limits configuration
INSERT INTO instance_settings (key, value) VALUES (
  'avatar_limits',
  '{
    "max_upload_size_bytes": 5242880,
    "max_dimension": 512,
    "default_dimension": 128,
    "output_quality": 85,
    "max_storage_per_user_bytes": 5242880
  }'::jsonb
) ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- MESSAGE SEGMENTS (50-hour chunks for chat history)
-- ============================================================

CREATE TABLE IF NOT EXISTS message_segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  dm_channel_id UUID REFERENCES dm_channels(id) ON DELETE CASCADE,
  segment_start TIMESTAMPTZ NOT NULL,
  segment_end TIMESTAMPTZ NOT NULL,
  message_count INTEGER DEFAULT 0,
  size_bytes BIGINT DEFAULT 0,
  is_archived BOOLEAN DEFAULT false,
  archive_path TEXT,  -- MinIO path when archived
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT segment_target CHECK (
    (channel_id IS NOT NULL AND dm_channel_id IS NULL) OR
    (channel_id IS NULL AND dm_channel_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_segments_channel ON message_segments(channel_id, segment_start DESC) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_segments_dm ON message_segments(dm_channel_id, segment_start DESC) WHERE dm_channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_segments_archived ON message_segments(is_archived, segment_end);
CREATE INDEX IF NOT EXISTS idx_segments_date_range ON message_segments(segment_start, segment_end);

-- ============================================================
-- CHANNEL RETENTION SETTINGS
-- ============================================================

ALTER TABLE channels ADD COLUMN IF NOT EXISTS retention_days INTEGER DEFAULT 180;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS retention_never BOOLEAN DEFAULT false;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS size_limit_bytes BIGINT DEFAULT NULL;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS pruning_enabled BOOLEAN DEFAULT true;

-- ============================================================
-- DM CHANNEL RETENTION SETTINGS
-- ============================================================

ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS retention_days INTEGER DEFAULT 90;
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS retention_never BOOLEAN DEFAULT false;
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS size_limit_bytes BIGINT DEFAULT NULL;

-- ============================================================
-- PINNED MESSAGES PROTECTION
-- ============================================================

ALTER TABLE pinned_messages ADD COLUMN IF NOT EXISTS exempt_from_trimming BOOLEAN DEFAULT true;

-- Add exempt_from_trimming flag to messages for manual protection
ALTER TABLE messages ADD COLUMN IF NOT EXISTS exempt_from_trimming BOOLEAN DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES message_segments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_segment ON messages(segment_id) WHERE segment_id IS NOT NULL;

-- ============================================================
-- RETENTION SETTINGS (Server-level defaults)
-- ============================================================

INSERT INTO instance_settings (key, value) VALUES (
  'retention_settings',
  '{
    "default_channel_retention_days": 180,
    "default_dm_retention_days": 90,
    "default_channel_size_limit_bytes": 1073741824,
    "storage_warning_threshold_percent": 80,
    "storage_action_threshold_percent": 90,
    "cleanup_schedule": "daily",
    "segment_duration_hours": 50,
    "min_retention_hours": 24,
    "archive_enabled": true
  }'::jsonb
) ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- STORAGE LIMITS (per-category)
-- ============================================================

INSERT INTO instance_settings (key, value) VALUES (
  'storage_limits',
  '{
    "channel_message_limit_bytes": null,
    "channel_attachment_limit_bytes": null,
    "dm_message_limit_bytes": null,
    "dm_attachment_limit_bytes": null,
    "emoji_storage_limit_bytes": null,
    "sticker_storage_limit_bytes": null,
    "profile_avatar_limit_bytes": null,
    "profile_banner_limit_bytes": null,
    "profile_sound_limit_bytes": null,
    "upload_limit_per_user_bytes": null,
    "archive_limit_bytes": null,
    "export_retention_days": 90,
    "crash_report_retention_days": 30,
    "notification_retention_days": 30,
    "trimming_log_retention_days": 90,
    "auto_purge_enabled": false,
    "auto_purge_threshold_percent": 90,
    "auto_purge_target_percent": 75
  }'::jsonb
) ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- TEMP VOICE CHANNEL SETTINGS
-- ============================================================

INSERT INTO instance_settings (key, value) VALUES (
  'temp_channel_settings',
  '{
    "empty_timeout_seconds": 300,
    "max_temp_channels_per_user": 1,
    "inherit_generator_permissions": true,
    "default_user_limit": 0,
    "default_bitrate": 64000
  }'::jsonb
) ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- TRIMMING AUDIT LOG ACTIONS
-- ============================================================

-- Update audit_log constraint to include trimming actions
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
  -- Existing actions
  'server_update', 'channel_create', 'channel_update', 'channel_delete',
  'role_create', 'role_update', 'role_delete',
  'member_kick', 'member_ban', 'member_unban',
  'invite_create', 'invite_delete',
  'admin_claimed', 'ownership_transferred',
  'category_create', 'category_update', 'category_delete',
  -- Permission actions
  'member_timeout', 'member_timeout_remove',
  'member_role_add', 'member_role_remove', 'member_role_update',
  'channel_permission_update', 'category_permission_update',
  'popup_config_update',
  'message_pin', 'message_unpin', 'message_delete',
  'webhook_create', 'webhook_update', 'webhook_delete',
  'emoji_create', 'emoji_update', 'emoji_delete',
  'sticker_create', 'sticker_update', 'sticker_delete',
  'event_create', 'event_update', 'event_delete',
  'thread_create', 'thread_update', 'thread_delete',
  -- Moderation actions
  'member_warn',
  -- Trimming/retention actions
  'retention_cleanup', 'segment_archived', 'segment_deleted',
  'size_limit_enforced', 'manual_cleanup_triggered'
));

-- ============================================================
-- TRIMMING LOG TABLE (detailed trimming history)
-- ============================================================

CREATE TABLE IF NOT EXISTS trimming_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  dm_channel_id UUID REFERENCES dm_channels(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('retention_cleanup', 'size_limit_enforced', 'segment_archived', 'segment_deleted', 'manual_cleanup', 'storage_purge')),
  messages_affected INTEGER DEFAULT 0,
  bytes_freed BIGINT DEFAULT 0,
  segment_ids UUID[] DEFAULT '{}',
  triggered_by TEXT CHECK (triggered_by IN ('scheduled', 'manual', 'size_limit', 'auto_purge')),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT trimming_log_target CHECK (
    (channel_id IS NOT NULL AND dm_channel_id IS NULL) OR
    (channel_id IS NULL AND dm_channel_id IS NOT NULL) OR
    (channel_id IS NULL AND dm_channel_id IS NULL) -- for server-wide operations
  )
);

CREATE INDEX IF NOT EXISTS idx_trimming_log_channel ON trimming_log(channel_id, created_at DESC) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trimming_log_dm ON trimming_log(dm_channel_id, created_at DESC) WHERE dm_channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trimming_log_date ON trimming_log(created_at DESC);

-- ============================================================
-- RETENTION/CLEANUP FUNCTIONS
-- ============================================================

-- Function to calculate channel storage size
CREATE OR REPLACE FUNCTION calculate_channel_storage(p_channel_id UUID)
RETURNS BIGINT AS $$
DECLARE
  total_size BIGINT;
BEGIN
  SELECT COALESCE(SUM(size_bytes), 0) INTO total_size
  FROM message_segments
  WHERE channel_id = p_channel_id;
  
  RETURN total_size;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate DM channel storage size
CREATE OR REPLACE FUNCTION calculate_dm_storage(p_dm_channel_id UUID)
RETURNS BIGINT AS $$
DECLARE
  total_size BIGINT;
BEGIN
  SELECT COALESCE(SUM(size_bytes), 0) INTO total_size
  FROM message_segments
  WHERE dm_channel_id = p_dm_channel_id;
  
  RETURN total_size;
END;
$$ LANGUAGE plpgsql;

-- Function to get the segment for a given timestamp (50-hour windows)
CREATE OR REPLACE FUNCTION get_segment_boundaries(p_timestamp TIMESTAMPTZ, p_duration_hours INTEGER DEFAULT 50)
RETURNS TABLE(segment_start TIMESTAMPTZ, segment_end TIMESTAMPTZ) AS $$
DECLARE
  epoch_start TIMESTAMPTZ := '2020-01-01 00:00:00+00'::TIMESTAMPTZ;
  hours_since_epoch BIGINT;
  segment_index BIGINT;
BEGIN
  hours_since_epoch := EXTRACT(EPOCH FROM (p_timestamp - epoch_start)) / 3600;
  segment_index := hours_since_epoch / p_duration_hours;
  
  segment_start := epoch_start + (segment_index * p_duration_hours * INTERVAL '1 hour');
  segment_end := segment_start + (p_duration_hours * INTERVAL '1 hour');
  
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- Function to run retention cleanup (returns summary)
CREATE OR REPLACE FUNCTION run_retention_cleanup()
RETURNS TABLE(
  channel_type TEXT,
  target_id UUID,
  messages_deleted INTEGER,
  bytes_freed BIGINT
) AS $$
DECLARE
  channel_rec RECORD;
  dm_rec RECORD;
  cutoff_date TIMESTAMPTZ;
  deleted_count INTEGER;
  freed_bytes BIGINT;
BEGIN
  -- Process server channels
  FOR channel_rec IN 
    SELECT c.id, c.retention_days, c.retention_never, c.pruning_enabled
    FROM channels c
    WHERE c.pruning_enabled = true AND c.retention_never = false AND c.retention_days IS NOT NULL
  LOOP
    cutoff_date := NOW() - (channel_rec.retention_days || ' days')::INTERVAL;
    
    -- Get stats before deletion
    SELECT COUNT(*)::INTEGER, COALESCE(SUM(LENGTH(content)), 0)::BIGINT
    INTO deleted_count, freed_bytes
    FROM messages m
    WHERE m.channel_id = channel_rec.id 
      AND m.created_at < cutoff_date
      AND m.exempt_from_trimming = false
      AND m.id NOT IN (SELECT pm.message_id FROM pinned_messages pm WHERE pm.channel_id = channel_rec.id AND pm.exempt_from_trimming = true);
    
    IF deleted_count > 0 THEN
      -- Delete old messages
      DELETE FROM messages m
      WHERE m.channel_id = channel_rec.id 
        AND m.created_at < cutoff_date
        AND m.exempt_from_trimming = false
        AND m.id NOT IN (SELECT pm.message_id FROM pinned_messages pm WHERE pm.channel_id = channel_rec.id AND pm.exempt_from_trimming = true);
      
      -- Log the cleanup
      INSERT INTO trimming_log (channel_id, action, messages_affected, bytes_freed, triggered_by, details)
      VALUES (channel_rec.id, 'retention_cleanup', deleted_count, freed_bytes, 'scheduled', 
              jsonb_build_object('cutoff_date', cutoff_date, 'retention_days', channel_rec.retention_days));
      
      channel_type := 'channel';
      target_id := channel_rec.id;
      messages_deleted := deleted_count;
      RETURN NEXT;
    END IF;
  END LOOP;
  
  -- Process DM channels
  FOR dm_rec IN 
    SELECT dc.id, dc.retention_days, dc.retention_never
    FROM dm_channels dc
    WHERE dc.retention_never = false AND dc.retention_days IS NOT NULL
  LOOP
    cutoff_date := NOW() - (dm_rec.retention_days || ' days')::INTERVAL;
    
    SELECT COUNT(*)::INTEGER, COALESCE(SUM(LENGTH(content)), 0)::BIGINT
    INTO deleted_count, freed_bytes
    FROM messages m
    WHERE m.dm_channel_id = dm_rec.id 
      AND m.created_at < cutoff_date
      AND m.exempt_from_trimming = false;
    
    IF deleted_count > 0 THEN
      DELETE FROM messages m
      WHERE m.dm_channel_id = dm_rec.id 
        AND m.created_at < cutoff_date
        AND m.exempt_from_trimming = false;
      
      INSERT INTO trimming_log (dm_channel_id, action, messages_affected, bytes_freed, triggered_by, details)
      VALUES (dm_rec.id, 'retention_cleanup', deleted_count, freed_bytes, 'scheduled',
              jsonb_build_object('cutoff_date', cutoff_date, 'retention_days', dm_rec.retention_days));
      
      channel_type := 'dm';
      target_id := dm_rec.id;
      messages_deleted := deleted_count;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to check storage thresholds and return channels needing attention
CREATE OR REPLACE FUNCTION check_storage_thresholds()
RETURNS TABLE(
  channel_type TEXT,
  target_id UUID,
  current_size_bytes BIGINT,
  limit_bytes BIGINT,
  threshold_percent INTEGER
) AS $$
DECLARE
  channel_rec RECORD;
  current_size BIGINT;
BEGIN
  -- Check channels with size limits
  FOR channel_rec IN 
    SELECT c.id, c.size_limit_bytes
    FROM channels c
    WHERE c.size_limit_bytes IS NOT NULL AND c.pruning_enabled = true
  LOOP
    current_size := calculate_channel_storage(channel_rec.id);
    
    IF current_size >= (channel_rec.size_limit_bytes * 0.8) THEN
      channel_type := 'channel';
      target_id := channel_rec.id;
      current_size_bytes := current_size;
      limit_bytes := channel_rec.size_limit_bytes;
      threshold_percent := ((current_size::FLOAT / channel_rec.size_limit_bytes) * 100)::INTEGER;
      RETURN NEXT;
    END IF;
  END LOOP;
  
  -- Check DM channels with size limits
  FOR channel_rec IN 
    SELECT dc.id, dc.size_limit_bytes
    FROM dm_channels dc
    WHERE dc.size_limit_bytes IS NOT NULL
  LOOP
    current_size := calculate_dm_storage(channel_rec.id);
    
    IF current_size >= (channel_rec.size_limit_bytes * 0.8) THEN
      channel_type := 'dm';
      target_id := channel_rec.id;
      current_size_bytes := current_size;
      limit_bytes := channel_rec.size_limit_bytes;
      threshold_percent := ((current_size::FLOAT / channel_rec.size_limit_bytes) * 100)::INTEGER;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to enforce size limits by deleting oldest segments
CREATE OR REPLACE FUNCTION run_size_limit_enforcement()
RETURNS TABLE(
  channel_type TEXT,
  target_id UUID,
  segments_trimmed INTEGER,
  bytes_freed BIGINT
) AS $$
DECLARE
  channel_rec RECORD;
  current_size BIGINT;
  segment_rec RECORD;
  deleted_segments INTEGER;
  freed_bytes BIGINT;
  min_retention_cutoff TIMESTAMPTZ;
BEGIN
  -- Minimum retention of 24 hours
  min_retention_cutoff := NOW() - INTERVAL '24 hours';
  
  -- Process channels over size limit
  FOR channel_rec IN 
    SELECT c.id, c.size_limit_bytes
    FROM channels c
    WHERE c.size_limit_bytes IS NOT NULL AND c.pruning_enabled = true
  LOOP
    current_size := calculate_channel_storage(channel_rec.id);
    deleted_segments := 0;
    freed_bytes := 0;
    
    -- Delete oldest non-archived segments until under limit
    WHILE current_size > channel_rec.size_limit_bytes LOOP
      SELECT * INTO segment_rec
      FROM message_segments ms
      WHERE ms.channel_id = channel_rec.id 
        AND ms.is_archived = false
        AND ms.segment_end < min_retention_cutoff
      ORDER BY ms.segment_start ASC
      LIMIT 1;
      
      EXIT WHEN segment_rec IS NULL;
      
      freed_bytes := freed_bytes + segment_rec.size_bytes;
      current_size := current_size - segment_rec.size_bytes;
      deleted_segments := deleted_segments + 1;
      
      -- Delete messages in segment
      DELETE FROM messages WHERE segment_id = segment_rec.id;
      DELETE FROM message_segments WHERE id = segment_rec.id;
    END LOOP;
    
    IF deleted_segments > 0 THEN
      INSERT INTO trimming_log (channel_id, action, messages_affected, bytes_freed, triggered_by, details)
      VALUES (channel_rec.id, 'size_limit_enforced', 0, freed_bytes, 'size_limit',
              jsonb_build_object('segments_deleted', deleted_segments, 'size_limit_bytes', channel_rec.size_limit_bytes));
      
      channel_type := 'channel';
      target_id := channel_rec.id;
      segments_trimmed := deleted_segments;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PG_CRON SCHEDULED JOBS
-- ============================================================

-- Note: pg_cron extension must be loaded via shared_preload_libraries
-- These jobs will be scheduled after the extension is available

-- Create a function to setup cron jobs (called after pg_cron is available)
CREATE OR REPLACE FUNCTION setup_retention_cron_jobs()
RETURNS void AS $$
BEGIN
  -- Check if pg_cron is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Daily retention cleanup at 3 AM UTC
    PERFORM cron.schedule('retention-cleanup-daily', '0 3 * * *', 
      $query$SELECT * FROM run_retention_cleanup()$query$);
    
    -- Hourly storage threshold check
    PERFORM cron.schedule('storage-monitor-hourly', '0 * * * *',
      $query$SELECT * FROM check_storage_thresholds()$query$);
    
    -- Weekly size limit enforcement (Sunday at 4 AM UTC)
    PERFORM cron.schedule('size-limit-weekly', '0 4 * * 0',
      $query$SELECT * FROM run_size_limit_enforcement()$query$);

    -- Clear stale activity every 5 minutes (15 min timeout)
    PERFORM cron.schedule('clear-stale-activity', '*/5 * * * *',
      $query$UPDATE users SET activity = NULL, activity_updated_at = NULL
        WHERE activity IS NOT NULL
          AND activity_updated_at < NOW() - INTERVAL '15 minutes'$query$);

    RAISE NOTICE 'pg_cron jobs scheduled successfully';
  ELSE
    RAISE NOTICE 'pg_cron extension not available, skipping job scheduling';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error scheduling pg_cron jobs: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Try to create pg_cron extension if available (will fail gracefully if not)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM setup_retention_cron_jobs();
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available during init, jobs will need to be scheduled manually or on next restart';
END;
$$;

-- ============================================================
-- SOUNDBOARD
-- ============================================================

ALTER TABLE servers ADD COLUMN IF NOT EXISTS soundboard_config JSONB DEFAULT jsonb_build_object(
  'enabled', true,
  'max_sounds_per_user', 3,
  'max_sound_duration_seconds', 5,
  'max_sound_size_bytes', 1048576
);

CREATE TABLE IF NOT EXISTS soundboard_sounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  uploader_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(32) NOT NULL,
  emoji VARCHAR(8),
  sound_url TEXT NOT NULL,
  duration_seconds FLOAT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  play_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(server_id, name)
);

CREATE INDEX IF NOT EXISTS idx_soundboard_server ON soundboard_sounds(server_id);
CREATE INDEX IF NOT EXISTS idx_soundboard_uploader ON soundboard_sounds(uploader_id, server_id);

-- ============================================================
-- USER VOICE SOUNDS (Custom join/leave)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_voice_sounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  sound_type VARCHAR(10) NOT NULL CHECK (sound_type IN ('join', 'leave')),
  sound_url TEXT NOT NULL,
  duration_seconds FLOAT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, server_id, sound_type)
);

CREATE INDEX IF NOT EXISTS idx_user_voice_sounds_user ON user_voice_sounds(user_id, server_id);

-- ============================================================
-- WARNINGS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS warnings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moderator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT CHECK (length(reason) <= 1024),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warnings_server_user ON warnings(server_id, user_id);
CREATE INDEX IF NOT EXISTS idx_warnings_server ON warnings(server_id, created_at DESC);

-- ============================================================
-- ROLE REACTION GROUPS
-- ============================================================

CREATE TABLE IF NOT EXISTS role_reaction_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,

  name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 100),
  description TEXT CHECK (length(description) <= 500),
  position INTEGER DEFAULT 0,
  enabled BOOLEAN DEFAULT true,
  remove_roles_on_disable BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (server_id, name)
);

CREATE INDEX IF NOT EXISTS idx_rrg_server ON role_reaction_groups(server_id, position);
CREATE INDEX IF NOT EXISTS idx_rrg_channel ON role_reaction_groups(channel_id);
CREATE INDEX IF NOT EXISTS idx_rrg_message ON role_reaction_groups(message_id) WHERE message_id IS NOT NULL;

-- ============================================================
-- ROLE REACTION MAPPINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS role_reaction_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES role_reaction_groups(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (length(emoji) >= 1 AND length(emoji) <= 32),
  label TEXT CHECK (length(label) <= 100),
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (group_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_rrm_group ON role_reaction_mappings(group_id, position);
CREATE INDEX IF NOT EXISTS idx_rrm_role ON role_reaction_mappings(role_id);

-- Update audit_log constraint to include role reaction actions
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
  -- Existing actions
  'server_update', 'channel_create', 'channel_update', 'channel_delete',
  'role_create', 'role_update', 'role_delete',
  'member_kick', 'member_ban', 'member_unban',
  'invite_create', 'invite_delete',
  'admin_claimed', 'ownership_transferred',
  'category_create', 'category_update', 'category_delete',
  -- Permission actions
  'member_timeout', 'member_timeout_remove',
  'member_role_add', 'member_role_remove', 'member_role_update',
  'channel_permission_update', 'category_permission_update',
  'popup_config_update',
  'message_pin', 'message_unpin', 'message_delete',
  'webhook_create', 'webhook_update', 'webhook_delete',
  'emoji_create', 'emoji_update', 'emoji_delete',
  'sticker_create', 'sticker_update', 'sticker_delete',
  'event_create', 'event_update', 'event_delete',
  'thread_create', 'thread_update', 'thread_delete',
  -- Moderation actions
  'member_warn',
  -- Trimming/retention actions
  'retention_cleanup', 'segment_archived', 'segment_deleted',
  'size_limit_enforced', 'manual_cleanup_triggered',
  -- Role reaction actions
  'role_reaction_group_create', 'role_reaction_group_update',
  'role_reaction_group_delete', 'role_reaction_group_toggle',
  'role_reaction_format_channel', 'role_reaction_setup'
));

-- ============================================================
-- PER-CHANNEL NOTIFICATION SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS channel_notification_settings (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'default' CHECK (level IN ('all', 'mentions', 'none', 'default')),
  suppress_everyone BOOLEAN DEFAULT false,
  suppress_roles BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, channel_id)
);

-- ============================================================
-- RELEASES (for desktop app update checking)
-- ============================================================

CREATE TABLE IF NOT EXISTS releases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'windows' CHECK (platform IN ('windows', 'mac', 'linux', 'all')),
  download_url TEXT NOT NULL,
  changelog TEXT,
  required BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_releases_platform ON releases(platform, published_at DESC);

-- ============================================================
-- CRASH REPORTS
-- ============================================================

CREATE TABLE IF NOT EXISTS crash_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  error_type TEXT,
  error_message TEXT,
  stack_trace TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crash_reports_created ON crash_reports(created_at DESC);

-- ============================================================
-- WEBHOOKS
-- ============================================================

CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 80),
  avatar_url TEXT,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_server ON webhooks(server_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_channel ON webhooks(channel_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_token ON webhooks(token);

-- ============================================================
-- THREADS
-- ============================================================

CREATE TABLE IF NOT EXISTS threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 100),
  creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_private BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  is_locked BOOLEAN DEFAULT false,
  message_count INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_threads_channel ON threads(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_server ON threads(server_id);
CREATE INDEX IF NOT EXISTS idx_threads_parent ON threads(parent_message_id);

-- Thread messages link to the thread
ALTER TABLE messages ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES threads(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at DESC) WHERE thread_id IS NOT NULL;

-- ============================================================
-- STICKERS
-- ============================================================

CREATE TABLE IF NOT EXISTS stickers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) >= 2 AND length(name) <= 30),
  description TEXT CHECK (length(description) <= 100),
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('png', 'gif', 'webp', 'apng')),
  file_size_bytes INTEGER,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stickers_server ON stickers(server_id);

-- ============================================================
-- EMOJI PACKS & EMOJIS
-- ============================================================

CREATE TABLE IF NOT EXISTS emoji_packs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 50),
  description TEXT CHECK (length(description) <= 200),
  enabled BOOLEAN DEFAULT true,
  source TEXT DEFAULT 'custom' CHECK (source IN ('custom', 'default')),
  default_pack_key TEXT DEFAULT NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emoji_packs_server ON emoji_packs(server_id);
CREATE INDEX IF NOT EXISTS idx_emoji_packs_server_enabled ON emoji_packs(server_id, enabled);
CREATE UNIQUE INDEX IF NOT EXISTS idx_emoji_packs_default_key ON emoji_packs(server_id, default_pack_key) WHERE default_pack_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS emojis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES emoji_packs(id) ON DELETE CASCADE,
  shortcode TEXT NOT NULL CHECK (length(shortcode) >= 2 AND length(shortcode) <= 32),
  content_type TEXT NOT NULL,
  is_animated BOOLEAN NOT NULL DEFAULT false,
  width INTEGER,
  height INTEGER,
  size_bytes BIGINT,
  asset_key TEXT NOT NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(server_id, shortcode)
);

CREATE INDEX IF NOT EXISTS idx_emojis_pack ON emojis(pack_id);
CREATE INDEX IF NOT EXISTS idx_emojis_server_pack ON emojis(server_id, pack_id);

-- ============================================================
-- MESSAGE REACTIONS (typed: unicode + custom emoji)
-- ============================================================

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL CHECK (reaction_type IN ('unicode', 'custom')),
  unicode_emoji TEXT,
  custom_emoji_id UUID REFERENCES emojis(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_reaction_value CHECK (
    (reaction_type = 'unicode' AND unicode_emoji IS NOT NULL AND custom_emoji_id IS NULL) OR
    (reaction_type = 'custom' AND unicode_emoji IS NULL AND custom_emoji_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_unique ON message_reactions(
  message_id, user_id, reaction_type,
  COALESCE(unicode_emoji, ''),
  COALESCE(custom_emoji_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_custom_emoji ON message_reactions(custom_emoji_id) WHERE custom_emoji_id IS NOT NULL;

-- ============================================================
-- SERVER EVENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS server_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  title VARCHAR(150) NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  announce_at_start BOOLEAN DEFAULT true,
  announcement_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
  visibility VARCHAR(10) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  status VARCHAR(15) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  cancelled_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_server_events_server_time ON server_events(server_id, start_time);
CREATE INDEX IF NOT EXISTS idx_server_events_server_status ON server_events(server_id, status, deleted_at);

CREATE TABLE IF NOT EXISTS server_event_roles (
  event_id UUID NOT NULL REFERENCES server_events(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, role_id)
);

CREATE TABLE IF NOT EXISTS server_event_rsvps (
  event_id UUID NOT NULL REFERENCES server_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('interested', 'tentative', 'not_interested')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_server_event_rsvps_status ON server_event_rsvps(event_id, status);

CREATE TABLE IF NOT EXISTS server_event_announcements (
  event_id UUID UNIQUE NOT NULL REFERENCES server_events(id) ON DELETE CASCADE,
  announced_at TIMESTAMPTZ DEFAULT NOW(),
  result VARCHAR(10) NOT NULL CHECK (result IN ('success', 'failed')),
  error_message TEXT
);

-- ============================================================
-- MIGRATION TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mark all migrations as applied (init.sql already includes their changes)
INSERT INTO _migrations (name) VALUES
  ('001_add_popup_config'),
  ('002_expand_channel_types'),
  ('003_temp_voice_channels'),
  ('004_soundboard'),
  ('005_user_profile_bio_banner'),
  ('005_warnings'),
  ('006_temp_channels_category'),
  ('007_temp_channel_timeout'),
  ('008_role_reactions'),
  ('009_desktop_parity'),
  ('010_message_search'),
  ('012_webhooks'),
  ('014_threads'),
  ('012_tts'),
  ('013_stickers'),
  ('015_emojis'),
  ('016_typed_reactions'),
  ('017_default_emoji_packs'),
  ('018_emoji_packs_enabled'),
  ('019_storage_limits'),
  ('020_server_events')
ON CONFLICT (name) DO NOTHING;
