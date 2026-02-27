-- Migration: Soundboard + Custom Join/Leave Sounds

ALTER TABLE servers ADD COLUMN IF NOT EXISTS soundboard_config JSONB DEFAULT jsonb_build_object(
  'enabled', true,
  'max_sounds_per_user', 3,
  'max_sound_duration_seconds', 5,
  'max_sound_size_bytes', 1048576
);

CREATE TABLE IF NOT EXISTS soundboard_sounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  uploader_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(32) NOT NULL,
  emoji VARCHAR(8),
  sound_url TEXT NOT NULL,
  duration_seconds FLOAT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  play_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(server_id, name)
);

CREATE INDEX IF NOT EXISTS idx_soundboard_server ON soundboard_sounds(server_id);
CREATE INDEX IF NOT EXISTS idx_soundboard_uploader ON soundboard_sounds(uploader_id, server_id);

CREATE TABLE IF NOT EXISTS user_voice_sounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  sound_type VARCHAR(10) NOT NULL CHECK (sound_type IN ('join', 'leave')),
  sound_url TEXT NOT NULL,
  duration_seconds FLOAT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, server_id, sound_type)
);

CREATE INDEX IF NOT EXISTS idx_user_voice_sounds_user ON user_voice_sounds(user_id, server_id);
