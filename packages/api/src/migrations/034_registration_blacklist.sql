-- Migration 034: Registration blacklist
-- Adds email/IP blacklist for registration and blacklist audit actions

CREATE TABLE IF NOT EXISTS registration_blacklist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL CHECK (type IN ('email', 'ip')),
  value       TEXT NOT NULL,
  reason      TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (type, value)
);

CREATE INDEX IF NOT EXISTS idx_registration_blacklist_lookup
  ON registration_blacklist(type, lower(value));

-- Add blacklist audit actions
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
  'role_reaction_format_channel', 'role_reaction_setup',
  -- Nickname actions
  'member_nickname_change', 'member_nickname_override',
  -- Access control actions
  'signup_settings_update', 'member_approved', 'member_denied', 'intake_form_updated',
  -- Blacklist actions
  'blacklist_add', 'blacklist_remove', 'blacklist_from_approval'
));

INSERT INTO _migrations (name) VALUES ('034_registration_blacklist') ON CONFLICT (name) DO NOTHING;
