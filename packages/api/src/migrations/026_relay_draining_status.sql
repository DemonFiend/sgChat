-- Migration 026: Add 'draining' to relay_servers status CHECK constraint
-- This allows relays to be gracefully drained before going offline.

-- Drop old constraint and add new one with 'draining'
ALTER TABLE relay_servers DROP CONSTRAINT IF EXISTS relay_servers_status_check;
ALTER TABLE relay_servers ADD CONSTRAINT relay_servers_status_check
  CHECK (status IN ('pending', 'trusted', 'suspended', 'offline', 'draining'));

-- Add composite index for health check queries (relayHealth.ts queries every 15s)
CREATE INDEX IF NOT EXISTS idx_relay_servers_status_health
  ON relay_servers(status, health_url) WHERE health_url IS NOT NULL;

-- Track migration
INSERT INTO _migrations (name) VALUES ('026_relay_draining_status')
ON CONFLICT DO NOTHING;
