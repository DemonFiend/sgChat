-- Migration 011: System User
-- Creates a well-known system user for seeding role-reaction emoji buttons
-- and other system-initiated actions.

INSERT INTO users (id, username, email, password_hash, display_name, status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'System',
  'system@localhost',
  '!disabled',
  'System',
  'offline'
) ON CONFLICT (id) DO NOTHING;

-- Add system user as member of all existing servers
INSERT INTO members (user_id, server_id)
SELECT '00000000-0000-0000-0000-000000000001', id FROM servers
ON CONFLICT DO NOTHING;
