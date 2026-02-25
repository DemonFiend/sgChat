/**
 * Trimming Service
 * 
 * Handles retention policy enforcement, cleanup orchestration,
 * and size-based pruning for message segments.
 */

import { db } from '../lib/db.js';
import { archiveSegment, deleteArchivedSegment } from './archive.js';
import { getArchivableSegments, getChannelStorageStats, getDMStorageStats, getServerStorageStats } from './segmentation.js';
import type { 
  ServerRetentionSettings, 
  ChannelRetentionSettings,
  DMRetentionSettings,
  CleanupSummary,
  StorageStats 
} from '@sgchat/shared';

// Default retention settings
const DEFAULT_RETENTION_SETTINGS: ServerRetentionSettings = {
  default_channel_retention_days: 180,
  default_dm_retention_days: 90,
  default_channel_size_limit_bytes: 1073741824, // 1GB
  storage_warning_threshold_percent: 80,
  storage_action_threshold_percent: 90,
  cleanup_schedule: 'daily',
  segment_duration_hours: 50,
  min_retention_hours: 24,
  archive_enabled: true,
};

/**
 * Get server-level retention settings.
 */
export async function getServerRetentionSettings(): Promise<ServerRetentionSettings> {
  const setting = await db.instanceSettings.get('retention_settings');
  if (!setting) {
    return DEFAULT_RETENTION_SETTINGS;
  }
  return { ...DEFAULT_RETENTION_SETTINGS, ...setting.value };
}

/**
 * Update server-level retention settings.
 */
export async function updateServerRetentionSettings(
  updates: Partial<ServerRetentionSettings>
): Promise<ServerRetentionSettings> {
  const current = await getServerRetentionSettings();
  const updated = { ...current, ...updates };
  await db.instanceSettings.set('retention_settings', updated);
  return updated;
}

/**
 * Get effective retention settings for a channel.
 * Combines channel-specific settings with server defaults.
 */
export async function getEffectiveChannelRetention(
  channelId: string
): Promise<ChannelRetentionSettings & { effective_retention_days: number }> {
  const channelSettings = await db.retention.getChannelRetention(channelId);
  const serverSettings = await getServerRetentionSettings();
  
  const effective = {
    retention_days: channelSettings?.retention_days ?? serverSettings.default_channel_retention_days,
    retention_never: channelSettings?.retention_never ?? false,
    size_limit_bytes: channelSettings?.size_limit_bytes ?? serverSettings.default_channel_size_limit_bytes,
    pruning_enabled: channelSettings?.pruning_enabled ?? true,
    effective_retention_days: channelSettings?.retention_never 
      ? -1 
      : (channelSettings?.retention_days ?? serverSettings.default_channel_retention_days),
  };
  
  return effective;
}

/**
 * Get effective retention settings for a DM channel.
 */
export async function getEffectiveDMRetention(
  dmChannelId: string
): Promise<DMRetentionSettings & { effective_retention_days: number }> {
  const dmSettings = await db.retention.getDMRetention(dmChannelId);
  const serverSettings = await getServerRetentionSettings();
  
  const effective = {
    retention_days: dmSettings?.retention_days ?? serverSettings.default_dm_retention_days,
    retention_never: dmSettings?.retention_never ?? false,
    size_limit_bytes: dmSettings?.size_limit_bytes ?? null,
    effective_retention_days: dmSettings?.retention_never 
      ? -1 
      : (dmSettings?.retention_days ?? serverSettings.default_dm_retention_days),
  };
  
  return effective;
}

/**
 * Get IDs of protected messages (pinned, exempt from trimming).
 */
export async function getProtectedMessageIds(
  channelId: string | null,
  dmChannelId: string | null
): Promise<Set<string>> {
  const protectedIds = new Set<string>();
  
  if (channelId) {
    // Get pinned messages that are exempt
    const pinnedMessages = await db.sql`
      SELECT message_id FROM pinned_messages
      WHERE channel_id = ${channelId} AND exempt_from_trimming = true
    `;
    pinnedMessages.forEach((pm: any) => protectedIds.add(pm.message_id));
    
    // Get messages explicitly marked as exempt
    const exemptMessages = await db.sql`
      SELECT id FROM messages
      WHERE channel_id = ${channelId} AND exempt_from_trimming = true
    `;
    exemptMessages.forEach((m: any) => protectedIds.add(m.id));
  }
  
  if (dmChannelId) {
    // DMs don't have pinned messages, but can have exempt messages
    const exemptMessages = await db.sql`
      SELECT id FROM messages
      WHERE dm_channel_id = ${dmChannelId} AND exempt_from_trimming = true
    `;
    exemptMessages.forEach((m: any) => protectedIds.add(m.id));
  }
  
  return protectedIds;
}

/**
 * Apply retention policy to a channel.
 * Deletes or archives messages older than the retention period.
 */
export async function applyRetentionPolicy(
  channelId: string | null,
  dmChannelId: string | null,
  options: {
    archiveBeforeDelete?: boolean;
    dryRun?: boolean;
  } = {}
): Promise<CleanupSummary> {
  const { archiveBeforeDelete = true, dryRun = false } = options;
  
  // Get retention settings
  let retentionDays: number;
  let retentionNever: boolean;
  
  if (channelId) {
    const settings = await getEffectiveChannelRetention(channelId);
    retentionDays = settings.effective_retention_days;
    retentionNever = settings.retention_never;
  } else if (dmChannelId) {
    const settings = await getEffectiveDMRetention(dmChannelId);
    retentionDays = settings.effective_retention_days;
    retentionNever = settings.retention_never;
  } else {
    throw new Error('Either channelId or dmChannelId must be provided');
  }
  
  // Skip if retention is set to never
  if (retentionNever || retentionDays < 0) {
    return {
      channel_type: channelId ? 'channel' : 'dm',
      target_id: (channelId || dmChannelId)!,
      messages_deleted: 0,
      bytes_freed: 0,
      segments_trimmed: 0,
    };
  }
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  
  // Get protected message IDs
  const protectedIds = await getProtectedMessageIds(channelId, dmChannelId);
  
  // Find segments to process
  const archivableSegments = await getArchivableSegments(channelId, dmChannelId, retentionDays);
  
  let messagesDeleted = 0;
  let bytesFreed = 0;
  let segmentsTrimmed = 0;
  
  if (dryRun) {
    // Just calculate what would be deleted
    for (const segment of archivableSegments) {
      messagesDeleted += segment.message_count;
      bytesFreed += Number(segment.size_bytes);
      segmentsTrimmed++;
    }
  } else {
    const serverSettings = await getServerRetentionSettings();
    
    for (const segment of archivableSegments) {
      // Archive before delete if enabled
      if (archiveBeforeDelete && serverSettings.archive_enabled && !segment.is_archived) {
        try {
          await archiveSegment(segment.id, { 
            deleteFromDb: true,
            includeReplyPreviews: true,
          });
        } catch (error) {
          console.error(`Failed to archive segment ${segment.id}:`, error);
          continue;
        }
      } else {
        // Delete segment directly
        await deleteArchivedSegment(segment.id);
      }
      
      messagesDeleted += segment.message_count;
      bytesFreed += Number(segment.size_bytes);
      segmentsTrimmed++;
    }
    
    // Also delete individual messages not in segments that are past retention
    if (channelId) {
      const result = await db.sql`
        WITH deleted AS (
          DELETE FROM messages
          WHERE channel_id = ${channelId}
            AND created_at < ${cutoffDate}
            AND exempt_from_trimming = false
            AND id NOT IN (
              SELECT message_id FROM pinned_messages 
              WHERE channel_id = ${channelId} AND exempt_from_trimming = true
            )
            AND segment_id IS NULL
          RETURNING id, LENGTH(content) as size
        )
        SELECT COUNT(*)::int as count, COALESCE(SUM(size), 0)::bigint as total_size FROM deleted
      `;
      messagesDeleted += result[0]?.count || 0;
      bytesFreed += Number(result[0]?.total_size || 0);
    } else if (dmChannelId) {
      const result = await db.sql`
        WITH deleted AS (
          DELETE FROM messages
          WHERE dm_channel_id = ${dmChannelId}
            AND created_at < ${cutoffDate}
            AND exempt_from_trimming = false
            AND segment_id IS NULL
          RETURNING id, LENGTH(content) as size
        )
        SELECT COUNT(*)::int as count, COALESCE(SUM(size), 0)::bigint as total_size FROM deleted
      `;
      messagesDeleted += result[0]?.count || 0;
      bytesFreed += Number(result[0]?.total_size || 0);
    }
  }
  
  // Log the cleanup
  if (!dryRun && messagesDeleted > 0) {
    await db.trimmingLog.create({
      channel_id: channelId || undefined,
      dm_channel_id: dmChannelId || undefined,
      action: 'retention_cleanup',
      messages_affected: messagesDeleted,
      bytes_freed: bytesFreed,
      segment_ids: archivableSegments.map(s => s.id),
      triggered_by: 'scheduled',
      details: {
        retention_days: retentionDays,
        cutoff_date: cutoffDate.toISOString(),
        segments_processed: segmentsTrimmed,
      },
    });
  }
  
  return {
    channel_type: channelId ? 'channel' : 'dm',
    target_id: (channelId || dmChannelId)!,
    messages_deleted: messagesDeleted,
    bytes_freed: bytesFreed,
    segments_trimmed: segmentsTrimmed,
  };
}

/**
 * Apply size limit policy to a channel.
 * Archives/deletes oldest segments until under the limit.
 */
export async function applySizeLimitPolicy(
  channelId: string | null,
  dmChannelId: string | null,
  options: {
    archiveBeforeDelete?: boolean;
    dryRun?: boolean;
  } = {}
): Promise<CleanupSummary> {
  const { archiveBeforeDelete = true, dryRun = false } = options;
  
  // Get size limit
  let sizeLimit: number | null;
  let currentSize: number;
  
  if (channelId) {
    const settings = await getEffectiveChannelRetention(channelId);
    sizeLimit = settings.size_limit_bytes;
    const stats = await getChannelStorageStats(channelId);
    currentSize = stats.total_size_bytes;
  } else if (dmChannelId) {
    const settings = await getEffectiveDMRetention(dmChannelId);
    sizeLimit = settings.size_limit_bytes;
    const stats = await getDMStorageStats(dmChannelId);
    currentSize = stats.total_size_bytes;
  } else {
    throw new Error('Either channelId or dmChannelId must be provided');
  }
  
  // Skip if no size limit
  if (!sizeLimit || currentSize <= sizeLimit) {
    return {
      channel_type: channelId ? 'channel' : 'dm',
      target_id: (channelId || dmChannelId)!,
      messages_deleted: 0,
      bytes_freed: 0,
      segments_trimmed: 0,
    };
  }
  
  const serverSettings = await getServerRetentionSettings();
  const minRetentionCutoff = new Date();
  minRetentionCutoff.setHours(minRetentionCutoff.getHours() - serverSettings.min_retention_hours);
  
  let messagesDeleted = 0;
  let bytesFreed = 0;
  let segmentsTrimmed = 0;
  
  // Get oldest segments that can be deleted
  const segments = await db.segments.getOldestUnarchived(channelId, dmChannelId, 100);
  
  for (const segment of segments) {
    // Stop if we're under the limit
    if (currentSize <= sizeLimit) break;
    
    // Don't delete segments within minimum retention period
    if (new Date(segment.segment_end) > minRetentionCutoff) continue;
    
    if (dryRun) {
      messagesDeleted += segment.message_count;
      bytesFreed += Number(segment.size_bytes);
      currentSize -= Number(segment.size_bytes);
      segmentsTrimmed++;
    } else {
      // Archive before delete if enabled
      if (archiveBeforeDelete && serverSettings.archive_enabled && !segment.is_archived) {
        try {
          await archiveSegment(segment.id, { 
            deleteFromDb: true,
            includeReplyPreviews: true,
          });
        } catch (error) {
          console.error(`Failed to archive segment ${segment.id}:`, error);
          continue;
        }
      } else {
        await deleteArchivedSegment(segment.id);
      }
      
      messagesDeleted += segment.message_count;
      bytesFreed += Number(segment.size_bytes);
      currentSize -= Number(segment.size_bytes);
      segmentsTrimmed++;
    }
  }
  
  // Log the cleanup
  if (!dryRun && messagesDeleted > 0) {
    await db.trimmingLog.create({
      channel_id: channelId || undefined,
      dm_channel_id: dmChannelId || undefined,
      action: 'size_limit_enforced',
      messages_affected: messagesDeleted,
      bytes_freed: bytesFreed,
      segment_ids: segments.slice(0, segmentsTrimmed).map((s: any) => s.id),
      triggered_by: 'size_limit',
      details: {
        size_limit_bytes: sizeLimit,
        previous_size: currentSize + bytesFreed,
        new_size: currentSize,
        segments_deleted: segmentsTrimmed,
      },
    });
  }
  
  return {
    channel_type: channelId ? 'channel' : 'dm',
    target_id: (channelId || dmChannelId)!,
    messages_deleted: messagesDeleted,
    bytes_freed: bytesFreed,
    segments_trimmed: segmentsTrimmed,
  };
}

/**
 * Run the full cleanup job for all channels.
 */
export async function runCleanupJob(
  options: {
    dryRun?: boolean;
  } = {}
): Promise<{
  summaries: CleanupSummary[];
  totalMessagesDeleted: number;
  totalBytesFreed: number;
}> {
  const { dryRun = false } = options;
  const summaries: CleanupSummary[] = [];
  
  // Get all channels with pruning enabled
  const channels = await db.sql`
    SELECT id FROM channels WHERE pruning_enabled = true
  `;
  
  for (const channel of channels) {
    // Apply retention policy
    const retentionSummary = await applyRetentionPolicy(channel.id, null, { dryRun });
    if (retentionSummary.messages_deleted > 0) {
      summaries.push(retentionSummary);
    }
    
    // Apply size limit policy
    const sizeSummary = await applySizeLimitPolicy(channel.id, null, { dryRun });
    if (sizeSummary.messages_deleted > 0) {
      summaries.push(sizeSummary);
    }
  }
  
  // Get all DM channels (all are eligible for cleanup)
  const dmChannels = await db.sql`
    SELECT id FROM dm_channels WHERE retention_never = false
  `;
  
  for (const dm of dmChannels) {
    // Apply retention policy
    const retentionSummary = await applyRetentionPolicy(null, dm.id, { dryRun });
    if (retentionSummary.messages_deleted > 0) {
      summaries.push(retentionSummary);
    }
    
    // Apply size limit policy
    const sizeSummary = await applySizeLimitPolicy(null, dm.id, { dryRun });
    if (sizeSummary.messages_deleted > 0) {
      summaries.push(sizeSummary);
    }
  }
  
  const totalMessagesDeleted = summaries.reduce((sum, s) => sum + s.messages_deleted, 0);
  const totalBytesFreed = summaries.reduce((sum, s) => sum + s.bytes_freed, 0);
  
  // Log overall cleanup if not dry run
  if (!dryRun && totalMessagesDeleted > 0) {
    await db.trimmingLog.create({
      action: 'retention_cleanup',
      messages_affected: totalMessagesDeleted,
      bytes_freed: totalBytesFreed,
      triggered_by: 'scheduled',
      details: {
        channels_processed: channels.length,
        dm_channels_processed: dmChannels.length,
        summaries_count: summaries.length,
      },
    });
  }
  
  return {
    summaries,
    totalMessagesDeleted,
    totalBytesFreed,
  };
}

/**
 * Check storage thresholds and return channels needing attention.
 */
export async function checkStorageThresholds(): Promise<{
  channel_type: 'channel' | 'dm';
  target_id: string;
  current_size_bytes: number;
  limit_bytes: number;
  threshold_percent: number;
}[]> {
  const results: {
    channel_type: 'channel' | 'dm';
    target_id: string;
    current_size_bytes: number;
    limit_bytes: number;
    threshold_percent: number;
  }[] = [];
  
  const serverSettings = await getServerRetentionSettings();
  const warningThreshold = serverSettings.storage_warning_threshold_percent / 100;
  
  // Check channels
  const channels = await db.sql`
    SELECT id, size_limit_bytes FROM channels
    WHERE size_limit_bytes IS NOT NULL AND pruning_enabled = true
  `;
  
  for (const channel of channels) {
    const stats = await getChannelStorageStats(channel.id);
    const usagePercent = stats.total_size_bytes / channel.size_limit_bytes;
    
    if (usagePercent >= warningThreshold) {
      results.push({
        channel_type: 'channel',
        target_id: channel.id,
        current_size_bytes: stats.total_size_bytes,
        limit_bytes: channel.size_limit_bytes,
        threshold_percent: Math.round(usagePercent * 100),
      });
    }
  }
  
  // Check DM channels
  const dmChannels = await db.sql`
    SELECT id, size_limit_bytes FROM dm_channels
    WHERE size_limit_bytes IS NOT NULL
  `;
  
  for (const dm of dmChannels) {
    const stats = await getDMStorageStats(dm.id);
    const usagePercent = stats.total_size_bytes / dm.size_limit_bytes;
    
    if (usagePercent >= warningThreshold) {
      results.push({
        channel_type: 'dm',
        target_id: dm.id,
        current_size_bytes: stats.total_size_bytes,
        limit_bytes: dm.size_limit_bytes,
        threshold_percent: Math.round(usagePercent * 100),
      });
    }
  }
  
  return results;
}

/**
 * Get trimming history/audit log.
 */
export async function getTrimmingLogs(
  options: {
    channelId?: string;
    dmChannelId?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<any[]> {
  const { channelId, dmChannelId, limit = 50, offset = 0 } = options;
  
  if (channelId) {
    return db.trimmingLog.findByChannel(channelId, limit, offset);
  } else if (dmChannelId) {
    return db.trimmingLog.findByDMChannel(dmChannelId, limit, offset);
  } else {
    return db.trimmingLog.findAll(limit, offset);
  }
}

// ============================================================
// STORAGE ALERT NOTIFICATIONS
// ============================================================

export interface StorageAlert {
  channel_type: 'channel' | 'dm';
  target_id: string;
  target_name?: string;
  current_size_bytes: number;
  limit_bytes: number;
  usage_percent: number;
  alert_level: 'warning' | 'critical';
  server_id?: string;
}

/**
 * Generate storage alerts for channels approaching or exceeding limits.
 * Returns alerts grouped by severity level.
 */
export async function generateStorageAlerts(): Promise<{
  warning: StorageAlert[];
  critical: StorageAlert[];
}> {
  const serverSettings = await getServerRetentionSettings();
  const warningThreshold = serverSettings.storage_warning_threshold_percent;
  const actionThreshold = serverSettings.storage_action_threshold_percent;

  const alerts: StorageAlert[] = [];

  // Check channels with size limits
  const channels = await db.sql`
    SELECT c.id, c.name, c.server_id, c.size_limit_bytes,
           COALESCE(SUM(ms.size_bytes), 0)::bigint as current_size
    FROM channels c
    LEFT JOIN message_segments ms ON c.id = ms.channel_id
    WHERE c.size_limit_bytes IS NOT NULL AND c.pruning_enabled = true
    GROUP BY c.id, c.name, c.server_id, c.size_limit_bytes
    HAVING COALESCE(SUM(ms.size_bytes), 0) >= (c.size_limit_bytes * ${warningThreshold / 100})
  `;

  for (const channel of channels) {
    const usagePercent = Math.round((Number(channel.current_size) / channel.size_limit_bytes) * 100);
    alerts.push({
      channel_type: 'channel',
      target_id: channel.id,
      target_name: channel.name,
      current_size_bytes: Number(channel.current_size),
      limit_bytes: channel.size_limit_bytes,
      usage_percent: usagePercent,
      alert_level: usagePercent >= actionThreshold ? 'critical' : 'warning',
      server_id: channel.server_id,
    });
  }

  // Check DM channels with size limits
  const dmChannels = await db.sql`
    SELECT dc.id, dc.size_limit_bytes,
           COALESCE(SUM(ms.size_bytes), 0)::bigint as current_size
    FROM dm_channels dc
    LEFT JOIN message_segments ms ON dc.id = ms.dm_channel_id
    WHERE dc.size_limit_bytes IS NOT NULL
    GROUP BY dc.id, dc.size_limit_bytes
    HAVING COALESCE(SUM(ms.size_bytes), 0) >= (dc.size_limit_bytes * ${warningThreshold / 100})
  `;

  for (const dm of dmChannels) {
    const usagePercent = Math.round((Number(dm.current_size) / dm.size_limit_bytes) * 100);
    alerts.push({
      channel_type: 'dm',
      target_id: dm.id,
      current_size_bytes: Number(dm.current_size),
      limit_bytes: dm.size_limit_bytes,
      usage_percent: usagePercent,
      alert_level: usagePercent >= actionThreshold ? 'critical' : 'warning',
    });
  }

  return {
    warning: alerts.filter(a => a.alert_level === 'warning'),
    critical: alerts.filter(a => a.alert_level === 'critical'),
  };
}

/**
 * Send storage alerts to server administrators.
 * Creates notifications for admins about channels approaching limits.
 */
export async function notifyAdminsOfStorageAlerts(
  serverId: string,
  alerts: StorageAlert[]
): Promise<{ notified: number; adminIds: string[] }> {
  if (alerts.length === 0) {
    return { notified: 0, adminIds: [] };
  }

  // Get server admins (owner + users with admin role)
  const server = await db.sql`SELECT owner_id FROM servers WHERE id = ${serverId}`;
  if (!server || server.length === 0) {
    return { notified: 0, adminIds: [] };
  }

  const adminUsers = await db.sql`
    SELECT DISTINCT sm.user_id
    FROM server_members sm
    INNER JOIN member_roles mr ON sm.user_id = mr.user_id AND sm.server_id = mr.server_id
    INNER JOIN roles r ON mr.role_id = r.id
    WHERE sm.server_id = ${serverId}
      AND (r.server_permissions::bigint & 8) = 8
  `;

  const adminIds = new Set<string>([
    server[0].owner_id,
    ...adminUsers.map((u: any) => u.user_id),
  ]);

  // Create notifications for each admin
  for (const adminId of adminIds) {
    const criticalCount = alerts.filter(a => a.alert_level === 'critical').length;
    const warningCount = alerts.filter(a => a.alert_level === 'warning').length;

    await db.sql`
      INSERT INTO notifications (user_id, type, data, priority)
      VALUES (
        ${adminId},
        'system',
        ${JSON.stringify({
          title: 'Storage Alert',
          message: `${criticalCount} channels critical, ${warningCount} channels warning`,
          alerts: alerts.slice(0, 5),
          total_alerts: alerts.length,
        })},
        ${criticalCount > 0 ? 'high' : 'normal'}
      )
    `;
  }

  return {
    notified: adminIds.size,
    adminIds: Array.from(adminIds),
  };
}

/**
 * Check all servers for storage alerts and notify admins.
 * This should be called periodically (e.g., hourly or daily).
 */
export async function runStorageAlertCheck(): Promise<{
  serversChecked: number;
  alertsGenerated: number;
  adminsNotified: number;
}> {
  const { warning, critical } = await generateStorageAlerts();
  const allAlerts = [...warning, ...critical];

  // Group alerts by server
  const alertsByServer = new Map<string, StorageAlert[]>();
  for (const alert of allAlerts) {
    if (alert.server_id) {
      const existing = alertsByServer.get(alert.server_id) || [];
      existing.push(alert);
      alertsByServer.set(alert.server_id, existing);
    }
  }

  let totalAdminsNotified = 0;

  // Notify admins of each server
  for (const [serverId, serverAlerts] of alertsByServer) {
    const result = await notifyAdminsOfStorageAlerts(serverId, serverAlerts);
    totalAdminsNotified += result.notified;
  }

  // Log the alert check
  if (allAlerts.length > 0) {
    await db.trimmingLog.create({
      action: 'retention_cleanup',
      messages_affected: 0,
      bytes_freed: 0,
      triggered_by: 'scheduled',
      details: {
        action_type: 'storage_alert_check',
        warning_count: warning.length,
        critical_count: critical.length,
        servers_notified: alertsByServer.size,
        admins_notified: totalAdminsNotified,
      },
    });
  }

  return {
    serversChecked: alertsByServer.size,
    alertsGenerated: allAlerts.length,
    adminsNotified: totalAdminsNotified,
  };
}

// ============================================================
// MEDIA FILE RETENTION
// ============================================================

/**
 * Calculate storage used by attachments for a channel.
 * Includes external media files in retention calculations.
 */
export async function calculateMediaStorageUsage(
  channelId: string | null,
  dmChannelId: string | null
): Promise<{
  total_attachment_size: number;
  attachment_count: number;
  attachment_types: Record<string, number>;
}> {
  const whereClause = channelId 
    ? db.sql`WHERE m.channel_id = ${channelId}`
    : db.sql`WHERE m.dm_channel_id = ${dmChannelId}`;

  const [stats] = await db.sql`
    SELECT 
      COALESCE(SUM(
        CASE 
          WHEN jsonb_typeof(m.attachments) = 'array' 
          THEN (
            SELECT COALESCE(SUM((a->>'size')::bigint), 0)
            FROM jsonb_array_elements(m.attachments) as a
          )
          ELSE 0 
        END
      ), 0)::bigint as total_size,
      COALESCE(SUM(
        CASE 
          WHEN jsonb_typeof(m.attachments) = 'array' 
          THEN jsonb_array_length(m.attachments)
          ELSE 0 
        END
      ), 0)::int as attachment_count
    FROM messages m
    ${whereClause}
  `;

  // Get breakdown by type
  const typeBreakdown = await db.sql`
    SELECT 
      a->>'type' as content_type,
      COUNT(*)::int as count
    FROM messages m,
      jsonb_array_elements(m.attachments) as a
    ${whereClause}
      AND jsonb_typeof(m.attachments) = 'array'
    GROUP BY a->>'type'
  `;

  const attachmentTypes: Record<string, number> = {};
  for (const row of typeBreakdown) {
    attachmentTypes[row.content_type || 'unknown'] = row.count;
  }

  return {
    total_attachment_size: Number(stats.total_size || 0),
    attachment_count: stats.attachment_count || 0,
    attachment_types: attachmentTypes,
  };
}

/**
 * Get comprehensive storage stats including media files.
 */
export async function getComprehensiveStorageStats(
  channelId: string | null,
  dmChannelId: string | null
): Promise<{
  message_storage: {
    total_size_bytes: number;
    active_size_bytes: number;
    archived_size_bytes: number;
  };
  media_storage: {
    total_size_bytes: number;
    attachment_count: number;
    by_type: Record<string, number>;
  };
  total_size_bytes: number;
}> {
  // Get message storage stats
  const getStats = channelId 
    ? () => getChannelStorageStats(channelId)
    : () => getDMStorageStats(dmChannelId!);
  
  const messageStats = await getStats();

  // Get media storage stats
  const mediaStats = await calculateMediaStorageUsage(channelId, dmChannelId);

  return {
    message_storage: {
      total_size_bytes: messageStats.total_size_bytes,
      active_size_bytes: messageStats.active_size_bytes,
      archived_size_bytes: messageStats.archived_size_bytes,
    },
    media_storage: {
      total_size_bytes: mediaStats.total_attachment_size,
      attachment_count: mediaStats.attachment_count,
      by_type: mediaStats.attachment_types,
    },
    total_size_bytes: messageStats.total_size_bytes + mediaStats.total_attachment_size,
  };
}
