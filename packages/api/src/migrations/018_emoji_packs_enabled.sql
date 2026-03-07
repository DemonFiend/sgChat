-- Add master toggle for emoji packs on the server level
ALTER TABLE servers ADD COLUMN IF NOT EXISTS emoji_packs_enabled BOOLEAN DEFAULT true;
