-- Default emoji packs support
-- Adds source tracking and default_pack_key to emoji_packs

ALTER TABLE emoji_packs
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'custom' CHECK (source IN ('custom', 'default')),
  ADD COLUMN IF NOT EXISTS default_pack_key TEXT DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_emoji_packs_default_key
  ON emoji_packs(server_id, default_pack_key) WHERE default_pack_key IS NOT NULL;
