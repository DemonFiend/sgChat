-- Add exclusive mode to role reaction groups
-- When exclusive = true, selecting a role in the group removes any other role from the same group
ALTER TABLE role_reaction_groups ADD COLUMN IF NOT EXISTS exclusive BOOLEAN DEFAULT false;

INSERT INTO applied_migrations (name) VALUES ('027_exclusive_role_groups') ON CONFLICT DO NOTHING;
