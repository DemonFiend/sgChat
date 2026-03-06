-- Migration 009: Desktop Parity Features
-- Activity/Rich Presence, Keybinds, Per-Channel Notifications, Releases, Crash Reports

-- ============================================================
-- 1. Activity / Rich Presence on users
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS activity JSONB DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS activity_updated_at TIMESTAMPTZ DEFAULT NULL;

-- ============================================================
-- 2. Keybinds on user_settings
-- ============================================================

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS keybinds JSONB DEFAULT '{}';

-- ============================================================
-- 3. Per-channel notification overrides
-- ============================================================

CREATE TABLE IF NOT EXISTS channel_notification_settings (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'default' CHECK (level IN ('all', 'mentions', 'none', 'default')),
  suppress_everyone BOOLEAN DEFAULT false,
  suppress_roles BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, channel_id)
);

-- ============================================================
-- 4. Releases table
-- ============================================================

CREATE TABLE IF NOT EXISTS releases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'windows' CHECK (platform IN ('windows', 'mac', 'linux', 'all')),
  download_url TEXT NOT NULL,
  changelog TEXT,
  required BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_releases_platform ON releases(platform, published_at DESC);

-- ============================================================
-- 5. Crash reports table
-- ============================================================

CREATE TABLE IF NOT EXISTS crash_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  error_type TEXT,
  error_message TEXT,
  stack_trace TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crash_reports_created ON crash_reports(created_at DESC);

-- ============================================================
-- 6. pg_cron: auto-clear stale activity (every 5 minutes)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('clear-stale-activity', '*/5 * * * *',
      $query$UPDATE users SET activity = NULL, activity_updated_at = NULL
        WHERE activity IS NOT NULL
          AND activity_updated_at < NOW() - INTERVAL '15 minutes'$query$
    );
    RAISE NOTICE 'Stale activity cleanup cron job scheduled';
  ELSE
    RAISE NOTICE 'pg_cron not available, skipping stale activity cleanup scheduling';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error scheduling stale activity cleanup: %', SQLERRM;
END;
$$;
