-- Migration 014: Threads
-- Adds thread support for text channels

CREATE TABLE IF NOT EXISTS threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 100),
  creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_private BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  is_locked BOOLEAN DEFAULT false,
  message_count INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_threads_channel ON threads(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_server ON threads(server_id);
CREATE INDEX IF NOT EXISTS idx_threads_parent ON threads(parent_message_id);

-- Thread messages link to the thread
ALTER TABLE messages ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES threads(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at DESC) WHERE thread_id IS NOT NULL;

INSERT INTO _migrations (name) VALUES ('014_threads') ON CONFLICT (name) DO NOTHING;
