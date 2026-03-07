-- 019_storage_limits.sql
-- Comprehensive per-category storage limits for sgChat

-- 1. Add storage_limits to instance_settings
INSERT INTO instance_settings (key, value) VALUES (
  'storage_limits',
  '{
    "channel_message_limit_bytes": null,
    "channel_attachment_limit_bytes": null,
    "dm_message_limit_bytes": null,
    "dm_attachment_limit_bytes": null,
    "emoji_storage_limit_bytes": null,
    "sticker_storage_limit_bytes": null,
    "profile_avatar_limit_bytes": null,
    "profile_banner_limit_bytes": null,
    "profile_sound_limit_bytes": null,
    "upload_limit_per_user_bytes": null,
    "archive_limit_bytes": null,
    "export_retention_days": 90,
    "crash_report_retention_days": 30,
    "notification_retention_days": 30,
    "trimming_log_retention_days": 90,
    "auto_purge_enabled": false,
    "auto_purge_threshold_percent": 90,
    "auto_purge_target_percent": 75
  }'::jsonb
) ON CONFLICT (key) DO NOTHING;

-- 2. Track banner file size on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_file_size INTEGER;

-- 3. Track sticker file size
ALTER TABLE stickers ADD COLUMN IF NOT EXISTS file_size_bytes INTEGER;

-- 4. Expand trimming_log action and triggered_by constraints for storage purge operations
ALTER TABLE trimming_log DROP CONSTRAINT IF EXISTS trimming_log_action_check;
ALTER TABLE trimming_log ADD CONSTRAINT trimming_log_action_check
  CHECK (action IN ('retention_cleanup', 'size_limit_enforced', 'segment_archived', 'segment_deleted', 'manual_cleanup', 'storage_purge'));

ALTER TABLE trimming_log DROP CONSTRAINT IF EXISTS trimming_log_triggered_by_check;
ALTER TABLE trimming_log ADD CONSTRAINT trimming_log_triggered_by_check
  CHECK (triggered_by IN ('scheduled', 'manual', 'size_limit', 'auto_purge'));

-- 5. Record migration
INSERT INTO _migrations (name) VALUES ('019_storage_limits') ON CONFLICT (name) DO NOTHING;
