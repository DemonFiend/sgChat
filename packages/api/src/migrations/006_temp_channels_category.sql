-- Migration: Add "Temp Channels" category and Create Temp VC generator channel
--
-- For existing deployments:
-- 1. Creates a "Temp Channels" category at position 3
-- 2. Creates a "Create Temp VC" generator channel if none exists
-- 3. Assigns any existing temp_voice_generator and temp_voice channels to the new category

-- Create the Temp Channels category for each server that doesn't have one
INSERT INTO categories (server_id, name, position)
SELECT s.id, 'Temp Channels', 3
FROM servers s
WHERE NOT EXISTS (
  SELECT 1 FROM categories c
  WHERE c.server_id = s.id AND c.name = 'Temp Channels'
);

-- Create a "Create Temp VC" generator channel for servers that don't have one
INSERT INTO channels (server_id, name, type, position, bitrate, user_limit, category_id)
SELECT
  s.id,
  'Create Temp VC',
  'temp_voice_generator',
  0,
  64000,
  0,
  cat.id
FROM servers s
JOIN categories cat ON cat.server_id = s.id AND cat.name = 'Temp Channels'
WHERE NOT EXISTS (
  SELECT 1 FROM channels ch
  WHERE ch.server_id = s.id AND ch.type = 'temp_voice_generator'
);

-- Move any existing temp_voice_generator channels to the Temp Channels category
UPDATE channels
SET category_id = cat.id
FROM categories cat
WHERE channels.type = 'temp_voice_generator'
  AND cat.server_id = channels.server_id
  AND cat.name = 'Temp Channels'
  AND (channels.category_id IS NULL OR channels.category_id != cat.id);

-- Move any existing temp_voice channels to the Temp Channels category
UPDATE channels
SET category_id = cat.id
FROM categories cat
WHERE channels.type = 'temp_voice'
  AND cat.server_id = channels.server_id
  AND cat.name = 'Temp Channels'
  AND (channels.category_id IS NULL OR channels.category_id != cat.id);
