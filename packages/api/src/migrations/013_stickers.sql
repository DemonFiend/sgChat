-- Migration 013: Stickers
-- Adds sticker support (per-server custom stickers)

CREATE TABLE IF NOT EXISTS stickers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) >= 2 AND length(name) <= 30),
  description TEXT CHECK (length(description) <= 100),
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('png', 'gif', 'webp', 'apng')),
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stickers_server ON stickers(server_id);

-- Track migration
INSERT INTO _migrations (name) VALUES ('013_stickers') ON CONFLICT (name) DO NOTHING;
