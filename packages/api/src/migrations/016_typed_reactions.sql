-- Migration 016: Typed Reactions
-- Converts message_reactions from simple emoji TEXT to typed model (unicode + custom)

-- Add new columns
ALTER TABLE message_reactions ADD COLUMN IF NOT EXISTS reaction_type TEXT;
ALTER TABLE message_reactions ADD COLUMN IF NOT EXISTS unicode_emoji TEXT;
ALTER TABLE message_reactions ADD COLUMN IF NOT EXISTS custom_emoji_id UUID REFERENCES emojis(id) ON DELETE SET NULL;

-- Backfill existing data: all existing reactions are unicode
UPDATE message_reactions
SET reaction_type = 'unicode', unicode_emoji = emoji
WHERE reaction_type IS NULL;

-- Make reaction_type NOT NULL after backfill
ALTER TABLE message_reactions ALTER COLUMN reaction_type SET NOT NULL;

-- Add check constraint for reaction_type
ALTER TABLE message_reactions ADD CONSTRAINT chk_reaction_type
  CHECK (reaction_type IN ('unicode', 'custom'));

-- Add check constraint: exactly one of unicode_emoji/custom_emoji_id must be set
ALTER TABLE message_reactions ADD CONSTRAINT chk_reaction_value
  CHECK (
    (reaction_type = 'unicode' AND unicode_emoji IS NOT NULL AND custom_emoji_id IS NULL) OR
    (reaction_type = 'custom' AND unicode_emoji IS NULL AND custom_emoji_id IS NOT NULL)
  );

-- Drop old PK and emoji column
ALTER TABLE message_reactions DROP CONSTRAINT IF EXISTS message_reactions_pkey;
ALTER TABLE message_reactions DROP COLUMN IF EXISTS emoji;

-- Add unique constraint via index (PK can't use expressions)
CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_unique ON message_reactions(
  message_id, user_id, reaction_type,
  COALESCE(unicode_emoji, ''),
  COALESCE(custom_emoji_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_reactions_custom_emoji ON message_reactions(custom_emoji_id) WHERE custom_emoji_id IS NOT NULL;

INSERT INTO _migrations (name) VALUES ('016_typed_reactions') ON CONFLICT (name) DO NOTHING;
