-- Migration: Add RSVP_EVENTS permission (bit 25 = 33554432) to all @everyone roles
-- This preserves existing behavior where all members can RSVP by default.

-- Update all @everyone roles to include the RSVP_EVENTS bit
UPDATE roles
SET server_permissions = (server_permissions::bigint | (1::bigint << 25))::text
WHERE name = '@everyone';

-- Update default_everyone_permissions in instance_settings
-- Previous server value was '6656' (CREATE_INVITES | CHANGE_NICKNAME | VIEW_AUDIT_LOG)
-- New value includes RSVP_EVENTS: 6656 + 33554432 = 33561088
UPDATE instance_settings
SET value = jsonb_set(value, '{server}', '"33561088"'),
    updated_at = NOW()
WHERE key = 'default_everyone_permissions';

-- Record migration
INSERT INTO _migrations (name) VALUES ('021_rsvp_events_permission');
