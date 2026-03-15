-- Ignored users table (client-side message hiding)
CREATE TABLE IF NOT EXISTS ignored_users (
  ignorer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ignored_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (ignorer_id, ignored_id),
  CONSTRAINT ignored_not_self CHECK (ignorer_id != ignored_id)
);
CREATE INDEX IF NOT EXISTS idx_ignored_users_ignorer ON ignored_users(ignorer_id);

-- Admin-forced nickname override on members
ALTER TABLE members ADD COLUMN IF NOT EXISTS admin_nickname TEXT CHECK (length(admin_nickname) <= 32);

-- Add new audit log actions (must include ALL existing actions from prior migrations)
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
  -- Core actions
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
  -- Nickname actions (new)
  'member_nickname_change', 'member_nickname_override'
));
