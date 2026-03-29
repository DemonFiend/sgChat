-- Migration 036: Add noise suppression mode and aggressiveness to user_settings
-- Replaces the boolean audio_noise_suppression / audio_ai_noise_suppression approach
-- with a mode enum + aggressiveness slider

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS noise_suppression_mode VARCHAR(16) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS noise_aggressiveness REAL NOT NULL DEFAULT 0.5
    CHECK (noise_aggressiveness >= 0.0 AND noise_aggressiveness <= 1.0);

-- Backfill existing users: derive mode from legacy booleans
UPDATE user_settings SET noise_suppression_mode =
  CASE
    WHEN audio_ai_noise_suppression = true THEN 'nsnet2'
    WHEN audio_noise_suppression = true THEN 'native'
    ELSE 'off'
  END
WHERE noise_suppression_mode IS NULL;
