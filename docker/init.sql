-- sgChat Database Schema
-- PostgreSQL 16+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT UNIQUE NOT NULL CHECK (length(username) >= 2 AND length(username) <= 32),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  
  -- Status
  status TEXT DEFAULT 'offline' CHECK (status IN ('active', 'idle', 'busy', 'dnd', 'invisible', 'offline')),
  custom_status TEXT CHECK (length(custom_status) <= 128),
  custom_status_emoji TEXT CHECK (length(custom_status_emoji) <= 10),
  status_expires_at TIMESTAMPTZ,
  
  -- Push notifications
  push_token TEXT,
  push_enabled BOOLEAN DEFAULT true,
  
  -- Activity tracking
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status) WHERE status != 'offline';

-- ============================================================
-- SERVERS
-- ============================================================

CREATE TABLE servers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 100),
  icon_url TEXT,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Special channels
  welcome_channel_id UUID, -- Set after channels are created
  afk_channel_id UUID,
  
  -- AFK settings
  afk_timeout INTEGER DEFAULT 300 CHECK (afk_timeout > 0), -- seconds
  
  -- Announcement settings
  announce_joins BOOLEAN DEFAULT true,
  announce_leaves BOOLEAN DEFAULT true,
  announce_online BOOLEAN DEFAULT false,
  
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
  type TEXT NOT NULL CHECK (type IN ('text', 'voice')),
  topic TEXT CHECK (length(topic) <= 1024),
  position INTEGER DEFAULT 0,
  
  -- Voice settings
  bitrate INTEGER DEFAULT 64000 CHECK (bitrate >= 8000 AND bitrate <= 384000),
  user_limit INTEGER DEFAULT 0 CHECK (user_limit >= 0 AND user_limit <= 99),
  is_afk_channel BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_channels_server ON channels(server_id, position);
CREATE INDEX idx_channels_type ON channels(server_id, type);

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
    'invite_create', 'invite_delete'
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
