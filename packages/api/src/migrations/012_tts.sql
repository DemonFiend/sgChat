-- Add TTS (text-to-speech) flag to messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_tts BOOLEAN DEFAULT false;
