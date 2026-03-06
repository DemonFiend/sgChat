-- Migration 010: Full-text search on messages
-- Adds tsvector column, GIN index, and auto-update trigger for message search

-- Add search vector column
ALTER TABLE messages ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Backfill existing messages
UPDATE messages SET search_vector = to_tsvector('english', coalesce(content, ''))
WHERE search_vector IS NULL;

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_messages_search ON messages USING GIN(search_vector);

-- Auto-update trigger function
CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger to ensure it's up to date
DROP TRIGGER IF EXISTS trg_messages_search_vector ON messages;
CREATE TRIGGER trg_messages_search_vector
  BEFORE INSERT OR UPDATE OF content ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_search_vector_update();
