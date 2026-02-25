-- Migration: Add temp voice channel support
-- 
-- Adds:
-- 1. New channel types: temp_voice_generator, temp_voice
-- 2. Temp channel metadata columns
-- 3. Instance settings for temp channel timeout

-- Update channel type constraint to include new types
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_type_check;
ALTER TABLE channels ADD CONSTRAINT channels_type_check 
  CHECK (type IN ('text', 'voice', 'announcement', 'music', 'temp_voice_generator', 'temp_voice'));

-- Add temp channel metadata columns
ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_temp_channel BOOLEAN DEFAULT false;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS temp_channel_owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS temp_channel_created_at TIMESTAMPTZ;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS temp_channel_last_empty_at TIMESTAMPTZ;

-- Index for finding empty temp channels to clean up
CREATE INDEX IF NOT EXISTS idx_channels_temp_cleanup 
  ON channels(temp_channel_last_empty_at) 
  WHERE is_temp_channel = true AND temp_channel_last_empty_at IS NOT NULL;

-- Add temp channel settings to instance_settings
INSERT INTO instance_settings (key, value) VALUES (
  'temp_channel_settings',
  '{
    "empty_timeout_seconds": 300,
    "max_temp_channels_per_user": 1,
    "inherit_generator_permissions": true,
    "default_user_limit": 0,
    "default_bitrate": 64000
  }'::jsonb
) ON CONFLICT (key) DO NOTHING;
