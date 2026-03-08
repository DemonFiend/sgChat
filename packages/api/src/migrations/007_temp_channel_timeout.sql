-- Add per-server temp channel timeout (default 15 minutes = 900 seconds)
ALTER TABLE servers ADD COLUMN IF NOT EXISTS temp_channel_timeout INTEGER DEFAULT 900
  CHECK (temp_channel_timeout >= 30 AND temp_channel_timeout <= 86400);
