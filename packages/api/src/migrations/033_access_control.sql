-- Migration 033: Private Server Mode — Access Control
-- Adds signup control, invite-only bypass, and member approvals

-- 1. Invites can bypass signup restrictions (invite-only registration)
ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS bypasses_signup_restriction BOOLEAN NOT NULL DEFAULT false;

-- 2. Access control settings (signups disabled, member approvals)
INSERT INTO instance_settings (key, value) VALUES
  ('access_control_settings', '{"signups_disabled": false, "member_approvals_enabled": false, "approvals_skip_for_invited": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 3. Intake form question configuration
INSERT INTO instance_settings (key, value) VALUES
  ('intake_form_config', '{"questions": []}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 4. Member approval requests
CREATE TABLE IF NOT EXISTS member_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  responses       JSONB DEFAULT '{}',
  invite_code     TEXT,
  reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  denial_reason   TEXT CHECK (length(denial_reason) <= 500),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  submitted_at    TIMESTAMPTZ,
  reviewed_at     TIMESTAMPTZ,
  UNIQUE(user_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_member_approvals_server_status ON member_approvals(server_id, status);
CREATE INDEX IF NOT EXISTS idx_member_approvals_user ON member_approvals(user_id);
CREATE INDEX IF NOT EXISTS idx_member_approvals_submitted ON member_approvals(server_id, submitted_at DESC) WHERE status = 'pending';

-- 5. Update audit log constraint to include access control actions
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
  'signup_settings_update', 'member_approved', 'member_denied', 'intake_form_updated'
));

-- Mark migration as applied
INSERT INTO _migrations (name) VALUES ('033_access_control') ON CONFLICT (name) DO NOTHING;
