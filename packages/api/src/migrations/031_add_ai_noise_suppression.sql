-- Migration 031: Add AI noise suppression setting
-- Adds a per-user toggle for client-side DTLN AI noise suppression (default: enabled)

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS audio_ai_noise_suppression BOOLEAN NOT NULL DEFAULT TRUE;
