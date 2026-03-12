-- 025_relay_servers.sql
-- Add relay server registry and channel relay policy columns

BEGIN;

-- Relay server registry
CREATE TABLE IF NOT EXISTS relay_servers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'trusted', 'suspended', 'offline')),

  -- Pairing
  pairing_token_hash TEXT,
  pairing_expires_at TIMESTAMPTZ,

  -- Connection info
  health_url TEXT,
  livekit_url TEXT,
  livekit_api_key_encrypted TEXT,
  livekit_api_secret_encrypted TEXT,

  -- Crypto
  relay_public_key TEXT,
  master_public_key TEXT,
  shared_secret_encrypted TEXT,
  trust_certificate TEXT,

  -- Operational
  max_participants INTEGER DEFAULT 100,
  current_participants INTEGER DEFAULT 0,
  allow_master_fallback BOOLEAN DEFAULT true,
  last_health_check TIMESTAMPTZ,
  last_health_status TEXT
    CHECK (last_health_status IS NULL OR last_health_status IN ('healthy', 'degraded', 'unreachable')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_relay_servers_status ON relay_servers(status);
CREATE INDEX IF NOT EXISTS idx_relay_servers_region ON relay_servers(region);

-- Channel relay policy columns
ALTER TABLE channels ADD COLUMN IF NOT EXISTS voice_relay_policy TEXT DEFAULT 'master'
  CHECK (voice_relay_policy IN ('master', 'auto', 'specific'));
ALTER TABLE channels ADD COLUMN IF NOT EXISTS preferred_relay_id UUID REFERENCES relay_servers(id) ON DELETE SET NULL;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS active_relay_id UUID REFERENCES relay_servers(id) ON DELETE SET NULL;

-- Track migration
INSERT INTO _migrations (name) VALUES ('025_relay_servers') ON CONFLICT (name) DO NOTHING;

COMMIT;
