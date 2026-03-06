-- Migration 008: Role Reactions
-- Adds role reaction groups and mappings tables for self-service role assignment

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
  'server_update', 'channel_create', 'channel_update', 'channel_delete',
  'role_create', 'role_update', 'role_delete',
  'member_kick', 'member_ban', 'member_unban',
  'invite_create', 'invite_delete',
  'admin_claimed', 'ownership_transferred',
  'category_create', 'category_update', 'category_delete',
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
  'member_warn',
  'retention_cleanup', 'segment_archived', 'segment_deleted',
  'size_limit_enforced', 'manual_cleanup_triggered',
  'role_reaction_group_create', 'role_reaction_group_update',
  'role_reaction_group_delete', 'role_reaction_group_toggle',
  'role_reaction_format_channel', 'role_reaction_setup'
));
