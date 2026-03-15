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

-- Add new audit log actions
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
  'server_update', 'channel_create', 'channel_update', 'channel_delete',
  'role_create', 'role_update', 'role_delete',
  'member_kick', 'member_ban', 'member_unban',
  'invite_create', 'invite_delete',
  'admin_claimed', 'ownership_transferred',
  'category_create', 'category_update', 'category_delete',
  'member_timeout', 'member_timeout_remove', 'member_warn',
  'member_role_update', 'member_nickname_change', 'member_nickname_override'
));

-- Track migration
INSERT INTO applied_migrations (name) VALUES ('029_ignore_and_admin_nickname') ON CONFLICT (name) DO NOTHING;
