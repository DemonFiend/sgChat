-- Migration 022: Add custom emoji support to role reaction mappings
-- Allows role reaction mappings to use custom server emojis instead of just unicode

ALTER TABLE role_reaction_mappings
  ADD COLUMN emoji_type TEXT NOT NULL DEFAULT 'unicode' CHECK (emoji_type IN ('unicode', 'custom')),
  ADD COLUMN custom_emoji_id UUID REFERENCES emojis(id) ON DELETE SET NULL;

-- Index for custom emoji lookups
CREATE INDEX IF NOT EXISTS idx_rrm_custom_emoji ON role_reaction_mappings(custom_emoji_id) WHERE custom_emoji_id IS NOT NULL;
