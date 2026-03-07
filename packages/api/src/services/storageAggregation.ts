import { sql } from '../lib/db.js';
import { storage } from '../lib/storage.js';
import { checkArchiveHealth, getArchiveStorageUsage } from './archive.js';

// ============================================================
// Types
// ============================================================

export interface StorageLimits {
  channel_message_limit_bytes: number | null;
  channel_attachment_limit_bytes: number | null;
  dm_message_limit_bytes: number | null;
  dm_attachment_limit_bytes: number | null;
  emoji_storage_limit_bytes: number | null;
  sticker_storage_limit_bytes: number | null;
  profile_avatar_limit_bytes: number | null;
  profile_banner_limit_bytes: number | null;
  profile_sound_limit_bytes: number | null;
  upload_limit_per_user_bytes: number | null;
  archive_limit_bytes: number | null;
  export_retention_days: number;
  crash_report_retention_days: number;
  notification_retention_days: number;
  trimming_log_retention_days: number;
  auto_purge_enabled: boolean;
  auto_purge_threshold_percent: number;
  auto_purge_target_percent: number;
}

const DEFAULT_LIMITS: StorageLimits = {
  channel_message_limit_bytes: null,
  channel_attachment_limit_bytes: null,
  dm_message_limit_bytes: null,
  dm_attachment_limit_bytes: null,
  emoji_storage_limit_bytes: null,
  sticker_storage_limit_bytes: null,
  profile_avatar_limit_bytes: null,
  profile_banner_limit_bytes: null,
  profile_sound_limit_bytes: null,
  upload_limit_per_user_bytes: null,
  archive_limit_bytes: null,
  export_retention_days: 90,
  crash_report_retention_days: 30,
  notification_retention_days: 30,
  trimming_log_retention_days: 90,
  auto_purge_enabled: false,
  auto_purge_threshold_percent: 90,
  auto_purge_target_percent: 75,
};

interface ChannelStorageRow {
  id: string;
  name: string;
  type: string;
  message_bytes: number;
  attachment_bytes: number;
  total_bytes: number;
}

interface ProfileSubStat {
  total_bytes: number;
  count: number;
}

interface Alert {
  category: string;
  message: string;
  severity: 'warning' | 'critical';
}

// ============================================================
// Storage Limits
// ============================================================

export async function getStorageLimits(): Promise<StorageLimits> {
  const [row] = await sql`
    SELECT value FROM instance_settings WHERE key = 'storage_limits'
  `;
  if (!row) return { ...DEFAULT_LIMITS };
  return { ...DEFAULT_LIMITS, ...row.value };
}

export async function updateStorageLimits(
  updates: Partial<StorageLimits>
): Promise<StorageLimits> {
  const current = await getStorageLimits();
  const merged = { ...current, ...updates };

  await sql`
    INSERT INTO instance_settings (key, value)
    VALUES ('storage_limits', ${JSON.stringify(merged)})
    ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(merged)}, updated_at = NOW()
  `;

  dashboardCache.clear();
  return merged;
}

// ============================================================
// Per-Category Aggregation
// ============================================================

export async function getChannelStorageSummary(
  serverId: string
): Promise<{
  total_bytes: number;
  message_bytes: number;
  attachment_bytes: number;
  channel_count: number;
  channels: ChannelStorageRow[];
  limit: number | null;
}> {
  const limits = await getStorageLimits();

  const channels = await sql`
    SELECT id, name, type FROM channels
    WHERE server_id = ${serverId} AND type IN ('text', 'announcement')
  `;

  const channelRows: ChannelStorageRow[] = [];
  let totalMessageBytes = 0;
  let totalAttachmentBytes = 0;

  for (const ch of channels) {
    const [stats] = await sql`
      SELECT
        COALESCE(SUM(LENGTH(content)), 0)::bigint AS message_bytes,
        COALESCE(SUM(
          CASE WHEN attachments IS NOT NULL AND attachments != '[]'
          THEN LENGTH(attachments::text) ELSE 0 END
        ), 0)::bigint AS attachment_bytes
      FROM messages
      WHERE channel_id = ${ch.id}
    `;

    const msgBytes = Number(stats?.message_bytes || 0);
    const attBytes = Number(stats?.attachment_bytes || 0);

    channelRows.push({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      message_bytes: msgBytes,
      attachment_bytes: attBytes,
      total_bytes: msgBytes + attBytes,
    });

    totalMessageBytes += msgBytes;
    totalAttachmentBytes += attBytes;
  }

  return {
    total_bytes: totalMessageBytes + totalAttachmentBytes,
    message_bytes: totalMessageBytes,
    attachment_bytes: totalAttachmentBytes,
    channel_count: channels.length,
    channels: channelRows,
    limit: limits.channel_message_limit_bytes,
  };
}

export async function getDMStorageAggregate(): Promise<{
  total_bytes: number;
  message_bytes: number;
  attachment_bytes: number;
  dm_count: number;
  avg_per_dm_bytes: number;
  median_per_dm_bytes: number;
  limit: number | null;
  slow_query?: boolean;
}> {
  const limits = await getStorageLimits();

  try {
    const [stats] = await sql`
      SELECT
        COUNT(DISTINCT dm.id)::int AS dm_count,
        COALESCE(SUM(LENGTH(m.content)), 0)::bigint AS message_bytes,
        COALESCE(SUM(
          CASE WHEN m.attachments IS NOT NULL AND m.attachments != '[]'
          THEN LENGTH(m.attachments::text) ELSE 0 END
        ), 0)::bigint AS attachment_bytes
      FROM dm_channels dm
      LEFT JOIN messages m ON m.dm_channel_id = dm.id
    `;

    const msgBytes = Number(stats?.message_bytes || 0);
    const attBytes = Number(stats?.attachment_bytes || 0);
    const dmCount = Number(stats?.dm_count || 0);
    const totalBytes = msgBytes + attBytes;
    const avgPerDm = dmCount > 0 ? Math.round(totalBytes / dmCount) : 0;

    // Median calculation
    let medianPerDm = 0;
    if (dmCount > 0) {
      const [medianRow] = await sql`
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY dm_total
        )::bigint AS median
        FROM (
          SELECT dm.id, COALESCE(SUM(LENGTH(m.content)) + SUM(
            CASE WHEN m.attachments IS NOT NULL AND m.attachments != '[]'
            THEN LENGTH(m.attachments::text) ELSE 0 END
          ), 0) AS dm_total
          FROM dm_channels dm
          LEFT JOIN messages m ON m.dm_channel_id = dm.id
          GROUP BY dm.id
        ) sub
      `;
      medianPerDm = Number(medianRow?.median || 0);
    }

    return {
      total_bytes: totalBytes,
      message_bytes: msgBytes,
      attachment_bytes: attBytes,
      dm_count: dmCount,
      avg_per_dm_bytes: avgPerDm,
      median_per_dm_bytes: medianPerDm,
      limit: limits.dm_message_limit_bytes,
    };
  } catch (error) {
    console.error('[StorageDashboard] DM aggregate query failed:', error);
    return {
      total_bytes: 0,
      message_bytes: 0,
      attachment_bytes: 0,
      dm_count: 0,
      avg_per_dm_bytes: 0,
      median_per_dm_bytes: 0,
      limit: limits.dm_message_limit_bytes,
      slow_query: true,
    };
  }
}

export async function getEmojiStorageStats(
  serverId: string
): Promise<{
  total_bytes: number;
  emoji_count: number;
  pack_count: number;
  limit: number | null;
}> {
  const limits = await getStorageLimits();

  const [stats] = await sql`
    SELECT
      COUNT(e.id)::int AS emoji_count,
      COUNT(DISTINCT e.pack_id)::int AS pack_count,
      COALESCE(SUM(e.file_size), 0)::bigint AS total_bytes
    FROM emojis e
    JOIN emoji_packs ep ON e.pack_id = ep.id
    WHERE ep.server_id = ${serverId}
  `;

  return {
    total_bytes: Number(stats?.total_bytes || 0),
    emoji_count: Number(stats?.emoji_count || 0),
    pack_count: Number(stats?.pack_count || 0),
    limit: limits.emoji_storage_limit_bytes,
  };
}

export async function getStickerStorageStats(
  serverId: string
): Promise<{
  total_bytes: number;
  sticker_count: number;
  limit: number | null;
}> {
  const limits = await getStorageLimits();

  const [stats] = await sql`
    SELECT
      COUNT(id)::int AS sticker_count,
      COALESCE(SUM(COALESCE(file_size_bytes, 0)), 0)::bigint AS total_bytes
    FROM stickers
    WHERE server_id = ${serverId}
  `;

  return {
    total_bytes: Number(stats?.total_bytes || 0),
    sticker_count: Number(stats?.sticker_count || 0),
    limit: limits.sticker_storage_limit_bytes,
  };
}

export async function getProfileStorageStats(
  serverId: string
): Promise<{
  total_bytes: number;
  avatars: ProfileSubStat;
  banners: ProfileSubStat;
  soundboard: ProfileSubStat;
  voice_sounds: ProfileSubStat;
}> {
  // Get member user IDs for this server
  const members = await sql`
    SELECT user_id FROM server_members WHERE server_id = ${serverId}
  `;
  const memberIds = members.map((m: any) => m.user_id);
  if (memberIds.length === 0) {
    return {
      total_bytes: 0,
      avatars: { total_bytes: 0, count: 0 },
      banners: { total_bytes: 0, count: 0 },
      soundboard: { total_bytes: 0, count: 0 },
      voice_sounds: { total_bytes: 0, count: 0 },
    };
  }

  // Avatars
  const [avatarStats] = await sql`
    SELECT
      COUNT(id)::int AS count,
      COALESCE(SUM(file_size), 0)::bigint AS total_bytes
    FROM user_avatars
    WHERE user_id = ANY(${memberIds})
  `;

  // Banners
  const [bannerStats] = await sql`
    SELECT
      COUNT(id)::int AS count,
      COALESCE(SUM(COALESCE(banner_file_size, 0)), 0)::bigint AS total_bytes
    FROM users
    WHERE id = ANY(${memberIds}) AND banner_url IS NOT NULL
  `;

  // Soundboard sounds
  const [soundboardStats] = await sql`
    SELECT
      COUNT(id)::int AS count,
      COALESCE(SUM(COALESCE(file_size_bytes, 0)), 0)::bigint AS total_bytes
    FROM soundboard_sounds
    WHERE server_id = ${serverId}
  `;

  // Voice sounds
  const [voiceSoundStats] = await sql`
    SELECT
      COUNT(id)::int AS count,
      COALESCE(SUM(COALESCE(file_size_bytes, 0)), 0)::bigint AS total_bytes
    FROM user_voice_sounds
    WHERE server_id = ${serverId}
  `;

  const avatars = {
    total_bytes: Number(avatarStats?.total_bytes || 0),
    count: Number(avatarStats?.count || 0),
  };
  const banners = {
    total_bytes: Number(bannerStats?.total_bytes || 0),
    count: Number(bannerStats?.count || 0),
  };
  const soundboard = {
    total_bytes: Number(soundboardStats?.total_bytes || 0),
    count: Number(soundboardStats?.count || 0),
  };
  const voice_sounds = {
    total_bytes: Number(voiceSoundStats?.total_bytes || 0),
    count: Number(voiceSoundStats?.count || 0),
  };

  return {
    total_bytes: avatars.total_bytes + banners.total_bytes + soundboard.total_bytes + voice_sounds.total_bytes,
    avatars,
    banners,
    soundboard,
    voice_sounds,
  };
}

export async function getUploadStorageStats(): Promise<{
  total_bytes: number;
  file_count: number;
  oldest_file: string | null;
  orphan_count: number;
}> {
  const [uploads, images] = await Promise.all([
    storage.listObjectsByPrefix('uploads/'),
    storage.listObjectsByPrefix('images/'),
  ]);

  const allFiles = [...uploads, ...images];
  if (allFiles.length === 0) {
    return { total_bytes: 0, file_count: 0, oldest_file: null, orphan_count: 0 };
  }

  allFiles.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());
  const totalBytes = allFiles.reduce((sum, f) => sum + f.size, 0);

  // Orphan detection: count files not referenced in messages.attachments
  // This is approximate — checks if the filename appears in any message attachment
  let orphanCount = 0;
  for (const file of allFiles) {
    const filename = file.path.split('/').pop();
    if (filename) {
      const [ref] = await sql`
        SELECT 1 FROM messages
        WHERE attachments::text LIKE ${'%' + filename + '%'}
        LIMIT 1
      `;
      if (!ref) orphanCount++;
    }
  }

  return {
    total_bytes: totalBytes,
    file_count: allFiles.length,
    oldest_file: allFiles[0].lastModified.toISOString(),
    orphan_count: orphanCount,
  };
}

export async function getArchiveStorageStats(): Promise<{
  total_bytes: number;
  archive_count: number;
  healthy: boolean;
  limit: number | null;
}> {
  const limits = await getStorageLimits();

  const [health, totalBytes] = await Promise.all([
    checkArchiveHealth(),
    getArchiveStorageUsage(),
  ]);

  return {
    total_bytes: totalBytes,
    archive_count: health.totalArchives,
    healthy: health.healthy,
    limit: limits.archive_limit_bytes,
  };
}

export async function getExportStorageStats(): Promise<{
  total_bytes: number;
  export_count: number;
  oldest_export: string | null;
}> {
  const result = await storage.getExportStorageUsage();
  return {
    total_bytes: result.total_bytes,
    export_count: result.count,
    oldest_export: result.oldest,
  };
}

export async function getDBTableStats(): Promise<{
  crash_reports: { count: number; est_bytes: number };
  notifications: { count: number; est_bytes: number };
  trimming_log: { count: number; est_bytes: number };
}> {
  const [crashCount] = await sql`SELECT COUNT(*)::int AS count FROM crash_reports`;
  const [notifCount] = await sql`SELECT COUNT(*)::int AS count FROM notifications`;
  const [logCount] = await sql`SELECT COUNT(*)::int AS count FROM trimming_log`;

  // Estimate table sizes using pg catalog
  const sizes = await sql`
    SELECT
      relname,
      pg_total_relation_size(c.oid)::bigint AS size_bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('crash_reports', 'notifications', 'trimming_log')
  `;

  const sizeMap: Record<string, number> = {};
  for (const row of sizes) {
    sizeMap[row.relname] = Number(row.size_bytes);
  }

  return {
    crash_reports: {
      count: Number(crashCount?.count || 0),
      est_bytes: sizeMap['crash_reports'] || 0,
    },
    notifications: {
      count: Number(notifCount?.count || 0),
      est_bytes: sizeMap['notifications'] || 0,
    },
    trimming_log: {
      count: Number(logCount?.count || 0),
      est_bytes: sizeMap['trimming_log'] || 0,
    },
  };
}

// ============================================================
// Dashboard Cache
// ============================================================

const dashboardCache = new Map<string, { data: any; expires: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds

// ============================================================
// Full Dashboard
// ============================================================

export async function getFullStorageDashboard(serverId: string) {
  const cacheKey = `dashboard:${serverId}`;
  const cached = dashboardCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const limits = await getStorageLimits();

  const results = await Promise.allSettled([
    getChannelStorageSummary(serverId),
    getDMStorageAggregate(),
    getEmojiStorageStats(serverId),
    getStickerStorageStats(serverId),
    getProfileStorageStats(serverId),
    getUploadStorageStats(),
    getArchiveStorageStats(),
    getExportStorageStats(),
    getDBTableStats(),
  ]);

  const extract = <T>(result: PromiseSettledResult<T>, label: string): T | null => {
    if (result.status === 'fulfilled') return result.value;
    console.error(`[StorageDashboard] ${label} aggregation failed:`, result.reason);
    return null;
  };

  const channels = extract(results[0], 'channels');
  const dms = extract(results[1], 'dms');
  const emojis = extract(results[2], 'emojis');
  const stickers = extract(results[3], 'stickers');
  const profiles = extract(results[4], 'profiles');
  const uploads = extract(results[5], 'uploads');
  const archives = extract(results[6], 'archives');
  const exports_ = extract(results[7], 'exports');
  const dbTables = extract(results[8], 'db_tables');

  const grandTotal =
    (channels?.total_bytes || 0) +
    (dms?.total_bytes || 0) +
    (emojis?.total_bytes || 0) +
    (stickers?.total_bytes || 0) +
    (profiles?.total_bytes || 0) +
    (uploads?.total_bytes || 0) +
    (archives?.total_bytes || 0) +
    (exports_?.total_bytes || 0) +
    (dbTables?.crash_reports.est_bytes || 0) +
    (dbTables?.notifications.est_bytes || 0) +
    (dbTables?.trimming_log.est_bytes || 0);

  // Generate alerts
  const alerts: Alert[] = [];
  const checkLimit = (
    category: string,
    used: number,
    limit: number | null
  ) => {
    if (!limit) return;
    const pct = (used / limit) * 100;
    if (pct >= 95) {
      alerts.push({ category, message: `${category} is at ${pct.toFixed(0)}% of limit`, severity: 'critical' });
    } else if (pct >= 80) {
      alerts.push({ category, message: `${category} is at ${pct.toFixed(0)}% of limit`, severity: 'warning' });
    }
  };

  checkLimit('channels', channels?.total_bytes || 0, limits.channel_message_limit_bytes);
  checkLimit('dms', dms?.total_bytes || 0, limits.dm_message_limit_bytes);
  checkLimit('emojis', emojis?.total_bytes || 0, limits.emoji_storage_limit_bytes);
  checkLimit('stickers', stickers?.total_bytes || 0, limits.sticker_storage_limit_bytes);
  checkLimit('archives', archives?.total_bytes || 0, limits.archive_limit_bytes);

  const data = {
    categories: {
      channels,
      dms,
      emojis,
      stickers,
      profiles,
      uploads,
      archives,
      exports: exports_,
      db_tables: dbTables,
    },
    grand_total_bytes: grandTotal,
    limits,
    alerts,
  };

  dashboardCache.set(cacheKey, { data, expires: Date.now() + CACHE_TTL_MS });
  return data;
}

// ============================================================
// Purge Operations
// ============================================================

export type PurgeCategory =
  | 'channels'
  | 'dms'
  | 'emojis'
  | 'stickers'
  | 'profiles'
  | 'uploads'
  | 'archives'
  | 'exports'
  | 'crash_reports'
  | 'notifications'
  | 'trimming_log';

interface PurgeOptions {
  category: PurgeCategory;
  percent?: number;
  channel_id?: string;
  older_than_days?: number;
  dry_run?: boolean;
}

export async function purgeByCategory(
  serverId: string,
  options: PurgeOptions,
  triggeredBy: 'manual' | 'auto_purge' = 'manual'
): Promise<{ items_affected: number; bytes_freed: number; dry_run: boolean }> {
  const { category, percent, channel_id, older_than_days, dry_run = false } = options;

  let itemsAffected = 0;
  let bytesFreed = 0;

  switch (category) {
    case 'channels': {
      const channelFilter = channel_id
        ? sql`AND m.channel_id = ${channel_id}`
        : sql`AND m.channel_id IN (SELECT id FROM channels WHERE server_id = ${serverId} AND type IN ('text', 'announcement'))`;

      if (percent) {
        const [countRow] = await sql`
          SELECT COUNT(*)::int AS total FROM messages m
          WHERE m.channel_id IS NOT NULL ${channelFilter}
        `;
        const deleteCount = Math.ceil((Number(countRow?.total || 0) * percent) / 100);
        if (deleteCount > 0) {
          const [sizeRow] = await sql`
            SELECT COALESCE(SUM(LENGTH(content)), 0)::bigint AS bytes
            FROM (
              SELECT content FROM messages m
              WHERE m.channel_id IS NOT NULL ${channelFilter}
              ORDER BY created_at ASC LIMIT ${deleteCount}
            ) sub
          `;
          bytesFreed = Number(sizeRow?.bytes || 0);
          itemsAffected = deleteCount;

          if (!dry_run) {
            await sql`
              DELETE FROM messages WHERE id IN (
                SELECT m.id FROM messages m
                WHERE m.channel_id IS NOT NULL ${channelFilter}
                ORDER BY m.created_at ASC LIMIT ${deleteCount}
              )
            `;
          }
        }
      }
      break;
    }

    case 'dms': {
      if (percent) {
        const [countRow] = await sql`
          SELECT COUNT(*)::int AS total FROM messages WHERE dm_channel_id IS NOT NULL
        `;
        const deleteCount = Math.ceil((Number(countRow?.total || 0) * percent) / 100);
        if (deleteCount > 0) {
          const [sizeRow] = await sql`
            SELECT COALESCE(SUM(LENGTH(content)), 0)::bigint AS bytes
            FROM (
              SELECT content FROM messages
              WHERE dm_channel_id IS NOT NULL
              ORDER BY created_at ASC LIMIT ${deleteCount}
            ) sub
          `;
          bytesFreed = Number(sizeRow?.bytes || 0);
          itemsAffected = deleteCount;

          if (!dry_run) {
            await sql`
              DELETE FROM messages WHERE id IN (
                SELECT id FROM messages
                WHERE dm_channel_id IS NOT NULL
                ORDER BY created_at ASC LIMIT ${deleteCount}
              )
            `;
          }
        }
      }
      break;
    }

    case 'emojis': {
      if (percent) {
        const emojis = await sql`
          SELECT e.id, e.image_url, e.file_size
          FROM emojis e
          JOIN emoji_packs ep ON e.pack_id = ep.id
          WHERE ep.server_id = ${serverId}
          ORDER BY e.created_at ASC
        `;
        const deleteCount = Math.ceil((emojis.length * percent) / 100);
        const toDelete = emojis.slice(0, deleteCount);

        for (const emoji of toDelete) {
          bytesFreed += Number(emoji.file_size || 0);
          itemsAffected++;
          if (!dry_run && emoji.image_url) {
            const path = emoji.image_url.split('/').slice(-2).join('/');
            await storage.deleteFile(path);
            await sql`DELETE FROM emojis WHERE id = ${emoji.id}`;
          }
        }
      }
      break;
    }

    case 'stickers': {
      if (percent) {
        const stickers = await sql`
          SELECT id, file_url, COALESCE(file_size_bytes, 0) AS file_size
          FROM stickers
          WHERE server_id = ${serverId}
          ORDER BY created_at ASC
        `;
        const deleteCount = Math.ceil((stickers.length * percent) / 100);
        const toDelete = stickers.slice(0, deleteCount);

        for (const sticker of toDelete) {
          bytesFreed += Number(sticker.file_size || 0);
          itemsAffected++;
          if (!dry_run && sticker.file_url) {
            const path = sticker.file_url.split('/').slice(-2).join('/');
            await storage.deleteFile(path);
            await sql`DELETE FROM stickers WHERE id = ${sticker.id}`;
          }
        }
      }
      break;
    }

    case 'profiles': {
      // Clean up profiles of users who left the server
      const orphanedUsers = await sql`
        SELECT u.id, u.avatar_url, u.banner_url, u.banner_file_size
        FROM users u
        WHERE u.avatar_url IS NOT NULL OR u.banner_url IS NOT NULL
        AND u.id NOT IN (SELECT user_id FROM server_members WHERE server_id = ${serverId})
        AND u.id IN (
          SELECT DISTINCT user_id FROM server_members
          WHERE server_id != ${serverId}
        ) IS FALSE
      `;
      // Note: This is complex — for now, just report count
      itemsAffected = orphanedUsers.length;
      for (const u of orphanedUsers) {
        bytesFreed += Number(u.banner_file_size || 0);
      }
      break;
    }

    case 'uploads': {
      const allFiles = [
        ...(await storage.listObjectsByPrefix('uploads/')),
        ...(await storage.listObjectsByPrefix('images/')),
      ];

      let filesToDelete = allFiles;
      if (older_than_days) {
        const cutoff = new Date(Date.now() - older_than_days * 24 * 60 * 60 * 1000);
        filesToDelete = allFiles.filter((f) => f.lastModified < cutoff);
      } else if (percent) {
        allFiles.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());
        const deleteCount = Math.ceil((allFiles.length * percent) / 100);
        filesToDelete = allFiles.slice(0, deleteCount);
      }

      for (const file of filesToDelete) {
        bytesFreed += file.size;
        itemsAffected++;
        if (!dry_run) {
          await storage.deleteFile(file.path);
        }
      }
      break;
    }

    case 'archives': {
      // Archive purge not yet implemented — archives use a separate MinIO bucket
      // and require coordination with the segmentation service
      break;
    }

    case 'exports': {
      const exportFiles = await storage.listObjectsByPrefix('exports/');
      let filesToDelete = exportFiles;

      if (older_than_days) {
        const cutoff = new Date(Date.now() - older_than_days * 24 * 60 * 60 * 1000);
        filesToDelete = exportFiles.filter((f) => f.lastModified < cutoff);
      } else if (percent) {
        exportFiles.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());
        const deleteCount = Math.ceil((exportFiles.length * percent) / 100);
        filesToDelete = exportFiles.slice(0, deleteCount);
      }

      for (const file of filesToDelete) {
        bytesFreed += file.size;
        itemsAffected++;
        if (!dry_run) {
          await storage.deleteFile(file.path);
        }
      }
      break;
    }

    case 'crash_reports': {
      const limits = await getStorageLimits();
      const cutoffDays = older_than_days || limits.crash_report_retention_days;
      const [result] = await sql`
        SELECT COUNT(*)::int AS count FROM crash_reports
        WHERE created_at < NOW() - INTERVAL '1 day' * ${cutoffDays}
      `;
      itemsAffected = Number(result?.count || 0);

      if (!dry_run && itemsAffected > 0) {
        await sql`
          DELETE FROM crash_reports
          WHERE created_at < NOW() - INTERVAL '1 day' * ${cutoffDays}
        `;
      }
      break;
    }

    case 'notifications': {
      const limits = await getStorageLimits();
      const cutoffDays = older_than_days || limits.notification_retention_days;
      const [result] = await sql`
        SELECT COUNT(*)::int AS count FROM notifications
        WHERE created_at < NOW() - INTERVAL '1 day' * ${cutoffDays}
      `;
      itemsAffected = Number(result?.count || 0);

      if (!dry_run && itemsAffected > 0) {
        await sql`
          DELETE FROM notifications
          WHERE created_at < NOW() - INTERVAL '1 day' * ${cutoffDays}
        `;
      }
      break;
    }

    case 'trimming_log': {
      const limits = await getStorageLimits();
      const cutoffDays = older_than_days || limits.trimming_log_retention_days;
      const [result] = await sql`
        SELECT COUNT(*)::int AS count FROM trimming_log
        WHERE created_at < NOW() - INTERVAL '1 day' * ${cutoffDays}
      `;
      itemsAffected = Number(result?.count || 0);

      if (!dry_run && itemsAffected > 0) {
        await sql`
          DELETE FROM trimming_log
          WHERE created_at < NOW() - INTERVAL '1 day' * ${cutoffDays}
        `;
      }
      break;
    }
  }

  // Log to trimming_log (unless we're purging the trimming_log itself)
  if (!dry_run && itemsAffected > 0 && category !== 'trimming_log') {
    await sql`
      INSERT INTO trimming_log (action, messages_affected, bytes_freed, triggered_by, details)
      VALUES (
        'storage_purge',
        ${itemsAffected},
        ${bytesFreed},
        ${triggeredBy},
        ${JSON.stringify({ category, percent, older_than_days })}
      )
    `;
  }

  // Invalidate cache after purge
  if (!dry_run) {
    dashboardCache.clear();
  }

  return { items_affected: itemsAffected, bytes_freed: bytesFreed, dry_run };
}

// ============================================================
// Auto-Purge
// ============================================================

export async function runAutoPurge(serverId: string): Promise<{
  categories_checked: number;
  categories_purged: number;
  total_bytes_freed: number;
}> {
  const limits = await getStorageLimits();

  if (!limits.auto_purge_enabled) {
    return { categories_checked: 0, categories_purged: 0, total_bytes_freed: 0 };
  }

  console.log('[AutoPurge] Running auto-purge cycle...');

  const threshold = limits.auto_purge_threshold_percent / 100;
  const target = limits.auto_purge_target_percent / 100;

  let categoriesChecked = 0;
  let categoriesPurged = 0;
  let totalBytesFreed = 0;

  const checkAndPurge = async (
    category: PurgeCategory,
    usedBytes: number,
    limitBytes: number | null
  ) => {
    categoriesChecked++;
    if (!limitBytes) return;

    const usagePercent = usedBytes / limitBytes;
    if (usagePercent <= threshold) return;

    // Calculate percent to purge to reach target
    const targetBytes = limitBytes * target;
    const bytesToFree = usedBytes - targetBytes;
    const purgePercent = Math.min(100, Math.ceil((bytesToFree / usedBytes) * 100));

    if (purgePercent <= 0) return;

    const result = await purgeByCategory(serverId, {
      category,
      percent: purgePercent,
      dry_run: false,
    }, 'auto_purge');

    if (result.items_affected > 0) {
      categoriesPurged++;
      totalBytesFreed += result.bytes_freed;
      const mbFreed = (result.bytes_freed / 1024 / 1024).toFixed(1);
      console.log(`[AutoPurge] ${category}: ${mbFreed} MB freed`);
    }
  };

  // Get current usage for categories with limits
  const dashboard = await getFullStorageDashboard(serverId);
  const cats = dashboard.categories;

  await checkAndPurge('channels', cats.channels?.total_bytes || 0, limits.channel_message_limit_bytes);
  await checkAndPurge('dms', cats.dms?.total_bytes || 0, limits.dm_message_limit_bytes);
  await checkAndPurge('emojis', cats.emojis?.total_bytes || 0, limits.emoji_storage_limit_bytes);
  await checkAndPurge('stickers', cats.stickers?.total_bytes || 0, limits.sticker_storage_limit_bytes);
  await checkAndPurge('archives', cats.archives?.total_bytes || 0, limits.archive_limit_bytes);

  const mbTotal = (totalBytesFreed / 1024 / 1024).toFixed(1);
  console.log(`[AutoPurge] Cycle complete: ${categoriesPurged} categories, ${mbTotal} MB freed`);

  return {
    categories_checked: categoriesChecked,
    categories_purged: categoriesPurged,
    total_bytes_freed: totalBytesFreed,
  };
}
