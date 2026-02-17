-- Migration: Expand channel types to include announcement and music
-- Date: 2026-02-16

-- Update the channel type constraint to include new types
ALTER TABLE channels 
  DROP CONSTRAINT IF EXISTS channels_type_check;

ALTER TABLE channels 
  ADD CONSTRAINT channels_type_check 
  CHECK (type IN ('text', 'voice', 'announcement', 'music'));
