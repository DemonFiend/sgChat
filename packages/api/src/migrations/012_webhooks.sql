-- Migration 012: Webhooks
-- Allows creating webhooks that can post messages to channels via token-based HTTP endpoints

CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 80),
  avatar_url TEXT,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_server ON webhooks(server_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_channel ON webhooks(channel_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_token ON webhooks(token);

INSERT INTO _migrations (name) VALUES ('012_webhooks') ON CONFLICT (name) DO NOTHING;
