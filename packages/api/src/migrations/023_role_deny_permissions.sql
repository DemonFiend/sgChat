-- Migration 023: Add deny permission columns to roles
-- Enables 3-state permission toggles: Allow / Deny / Default (inherit)

ALTER TABLE roles ADD COLUMN IF NOT EXISTS server_permissions_deny TEXT DEFAULT '0';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS text_permissions_deny TEXT DEFAULT '0';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS voice_permissions_deny TEXT DEFAULT '0';
