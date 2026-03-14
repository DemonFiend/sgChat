-- Migration 028: Add mode column to role_reaction_groups for Modern vs Legacy picker
-- Existing groups default to 'legacy' to preserve current behavior

-- Add mode column (existing groups get 'legacy')
ALTER TABLE role_reaction_groups
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'legacy'
  CHECK (mode IN ('modern', 'legacy'));

-- Change default for new groups to 'modern'
ALTER TABLE role_reaction_groups ALTER COLUMN mode SET DEFAULT 'modern';

-- Make channel_id nullable (modern-only groups don't need a channel)
ALTER TABLE role_reaction_groups ALTER COLUMN channel_id DROP NOT NULL;
