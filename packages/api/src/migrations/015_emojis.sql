-- Migration 015: Custom Emoji Packs & Emojis
-- Adds per-server custom emoji pack support

CREATE TABLE IF NOT EXISTS emoji_packs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 50),
  description TEXT CHECK (length(description) <= 200),
  enabled BOOLEAN DEFAULT true,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emoji_packs_server ON emoji_packs(server_id);
CREATE INDEX IF NOT EXISTS idx_emoji_packs_server_enabled ON emoji_packs(server_id, enabled);

CREATE TABLE IF NOT EXISTS emojis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES emoji_packs(id) ON DELETE CASCADE,
  shortcode TEXT NOT NULL CHECK (length(shortcode) >= 2 AND length(shortcode) <= 32),
  content_type TEXT NOT NULL,
  is_animated BOOLEAN NOT NULL DEFAULT false,
  width INTEGER,
  height INTEGER,
  size_bytes BIGINT,
  asset_key TEXT NOT NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(server_id, shortcode)
);

CREATE INDEX IF NOT EXISTS idx_emojis_pack ON emojis(pack_id);
CREATE INDEX IF NOT EXISTS idx_emojis_server_pack ON emojis(server_id, pack_id);

INSERT INTO _migrations (name) VALUES ('015_emojis') ON CONFLICT (name) DO NOTHING;
