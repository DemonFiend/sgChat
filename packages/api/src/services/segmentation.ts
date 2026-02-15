/**
 * Segmentation Service
 * 
 * Manages message segments (50-hour chunks) for efficient chat history
 * storage, retrieval, and archiving.
 */

import { db } from '../lib/db.js';
import type { MessageSegment, StorageStats } from '@sgchat/shared';

// Default segment duration in hours
const DEFAULT_SEGMENT_DURATION_HOURS = 50;

// Epoch start for segment calculations
const EPOCH_START = new Date('2020-01-01T00:00:00Z');

/**
 * Calculate segment boundaries for a given timestamp.
 * Segments are aligned to fixed 50-hour windows since epoch.
 */
export function calculateSegmentBoundaries(
  timestamp: Date,
  durationHours: number = DEFAULT_SEGMENT_DURATION_HOURS
): { segmentStart: Date; segmentEnd: Date } {
  const hoursSinceEpoch = (timestamp.getTime() - EPOCH_START.getTime()) / (1000 * 60 * 60);
  const segmentIndex = Math.floor(hoursSinceEpoch / durationHours);
  
  const segmentStart = new Date(EPOCH_START.getTime() + segmentIndex * durationHours * 60 * 60 * 1000);
  const segmentEnd = new Date(segmentStart.getTime() + durationHours * 60 * 60 * 1000);
  
  return { segmentStart, segmentEnd };
}

/**
 * Get or create a segment for a given channel/DM and timestamp.
 */
export async function getOrCreateSegment(
  channelId: string | null,
  dmChannelId: string | null,
  timestamp: Date = new Date()
): Promise<MessageSegment> {
  // Calculate boundaries
  const { segmentStart, segmentEnd } = calculateSegmentBoundaries(timestamp);
  
  // Try to find existing segment
  const existing = await db.segments.findByTimestamp(channelId, dmChannelId, timestamp);
  if (existing) {
    return existing as MessageSegment;
  }
  
  // Create new segment
  const segment = await db.segments.create({
    channel_id: channelId || undefined,
    dm_channel_id: dmChannelId || undefined,
    segment_start: segmentStart,
    segment_end: segmentEnd,
  });
  
  return segment as MessageSegment;
}

/**
 * Get all segments for a channel within a date range.
 */
export async function getSegmentsForChannel(
  channelId: string,
  options: {
    startDate?: Date;
    endDate?: Date;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<MessageSegment[]> {
  const { limit = 50, offset = 0 } = options;
  
  const rawSegments = await db.segments.findByChannelId(channelId, limit, offset);
  let segments: MessageSegment[] = [...rawSegments] as MessageSegment[];
  
  // Filter by date range if specified
  if (options.startDate || options.endDate) {
    segments = segments.filter((s) => {
      const start = new Date(s.segment_start);
      const end = new Date(s.segment_end);
      
      if (options.startDate && end < options.startDate) return false;
      if (options.endDate && start > options.endDate) return false;
      return true;
    });
  }
  
  // Filter archived if needed
  if (options.includeArchived === false) {
    segments = segments.filter((s) => !s.is_archived);
  }
  
  return segments;
}

/**
 * Get all segments for a DM channel within a date range.
 */
export async function getSegmentsForDM(
  dmChannelId: string,
  options: {
    startDate?: Date;
    endDate?: Date;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<MessageSegment[]> {
  const { limit = 50, offset = 0 } = options;
  
  const rawSegments = await db.segments.findByDMChannelId(dmChannelId, limit, offset);
  let segments: MessageSegment[] = [...rawSegments] as MessageSegment[];
  
  // Filter by date range if specified
  if (options.startDate || options.endDate) {
    segments = segments.filter((s) => {
      const start = new Date(s.segment_start);
      const end = new Date(s.segment_end);
      
      if (options.startDate && end < options.startDate) return false;
      if (options.endDate && start > options.endDate) return false;
      return true;
    });
  }
  
  // Filter archived if needed
  if (options.includeArchived === false) {
    segments = segments.filter((s) => !s.is_archived);
  }
  
  return segments;
}

/**
 * Update segment statistics after a message is added.
 */
export async function onMessageCreated(
  segmentId: string,
  messageContent: string,
  attachments: any[] = []
): Promise<void> {
  // Calculate approximate size
  const contentSize = Buffer.byteLength(messageContent, 'utf8');
  const attachmentsSize = attachments.reduce((sum, a) => sum + (a.size || 0), 0);
  const estimatedOverhead = 200; // JSON structure overhead
  
  const sizeBytes = contentSize + attachmentsSize + estimatedOverhead;
  
  await db.segments.incrementStats(segmentId, 1, sizeBytes);
}

/**
 * Update segment statistics after a message is deleted.
 */
export async function onMessageDeleted(
  segmentId: string,
  messageContent: string,
  attachments: any[] = []
): Promise<void> {
  const contentSize = Buffer.byteLength(messageContent, 'utf8');
  const attachmentsSize = attachments.reduce((sum, a) => sum + (a.size || 0), 0);
  const estimatedOverhead = 200;
  
  const sizeBytes = contentSize + attachmentsSize + estimatedOverhead;
  
  await db.segments.incrementStats(segmentId, -1, -sizeBytes);
}

/**
 * Recalculate segment statistics from actual messages.
 */
export async function recalculateSegmentStats(segmentId: string): Promise<void> {
  const segment = await db.segments.findById(segmentId);
  if (!segment) return;
  
  // Count messages and calculate size
  const [stats] = await db.sql`
    SELECT 
      COUNT(*)::int as message_count,
      COALESCE(SUM(LENGTH(content)), 0)::bigint as content_size
    FROM messages
    WHERE segment_id = ${segmentId}
  `;
  
  // Add estimated overhead per message
  const estimatedSize = (stats.content_size || 0) + (stats.message_count || 0) * 200;
  
  await db.segments.updateStats(segmentId, stats.message_count || 0, estimatedSize);
}

/**
 * Get storage statistics for a channel.
 */
export async function getChannelStorageStats(channelId: string): Promise<StorageStats> {
  const stats = await db.segments.getChannelStorageStats(channelId);
  
  // Get oldest message date
  const [oldest] = await db.sql`
    SELECT MIN(created_at) as oldest_date
    FROM messages
    WHERE channel_id = ${channelId}
  `;
  
  return {
    total_messages: stats.total_messages || 0,
    total_size_bytes: Number(stats.total_size_bytes) || 0,
    active_size_bytes: Number(stats.active_size_bytes) || 0,
    archived_size_bytes: Number(stats.archived_size_bytes) || 0,
    segments_count: stats.segments_count || 0,
    archived_segments_count: stats.archived_segments_count || 0,
    oldest_message_date: oldest?.oldest_date || null,
  };
}

/**
 * Get storage statistics for a DM channel.
 */
export async function getDMStorageStats(dmChannelId: string): Promise<StorageStats> {
  const stats = await db.segments.getDMStorageStats(dmChannelId);
  
  // Get oldest message date
  const [oldest] = await db.sql`
    SELECT MIN(created_at) as oldest_date
    FROM messages
    WHERE dm_channel_id = ${dmChannelId}
  `;
  
  return {
    total_messages: stats.total_messages || 0,
    total_size_bytes: Number(stats.total_size_bytes) || 0,
    active_size_bytes: Number(stats.active_size_bytes) || 0,
    archived_size_bytes: Number(stats.archived_size_bytes) || 0,
    segments_count: stats.segments_count || 0,
    archived_segments_count: stats.archived_segments_count || 0,
    oldest_message_date: oldest?.oldest_date || null,
  };
}

/**
 * Get storage statistics for an entire server.
 */
export async function getServerStorageStats(serverId: string): Promise<StorageStats> {
  const stats = await db.segments.getServerStorageStats(serverId);
  
  // Get oldest message date across all channels
  const [oldest] = await db.sql`
    SELECT MIN(m.created_at) as oldest_date
    FROM messages m
    INNER JOIN channels c ON m.channel_id = c.id
    WHERE c.server_id = ${serverId}
  `;
  
  return {
    total_messages: stats.total_messages || 0,
    total_size_bytes: Number(stats.total_size_bytes) || 0,
    active_size_bytes: Number(stats.active_size_bytes) || 0,
    archived_size_bytes: Number(stats.archived_size_bytes) || 0,
    segments_count: stats.segments_count || 0,
    archived_segments_count: stats.archived_segments_count || 0,
    oldest_message_date: oldest?.oldest_date || null,
  };
}

/**
 * Find the segment containing a specific message.
 */
export async function findSegmentForMessage(messageId: string): Promise<MessageSegment | null> {
  const [message] = await db.sql`
    SELECT segment_id FROM messages WHERE id = ${messageId}
  `;
  
  if (!message?.segment_id) return null;
  
  const segment = await db.segments.findById(message.segment_id);
  return segment as MessageSegment | null;
}

/**
 * Assign a message to a segment (used when creating messages).
 */
export async function assignMessageToSegment(
  messageId: string,
  channelId: string | null,
  dmChannelId: string | null,
  messageTimestamp: Date
): Promise<string> {
  const segment = await getOrCreateSegment(channelId, dmChannelId, messageTimestamp);
  
  await db.sql`
    UPDATE messages SET segment_id = ${segment.id} WHERE id = ${messageId}
  `;
  
  return segment.id;
}

/**
 * Get segments that are candidates for archiving (older than X days, not already archived).
 */
export async function getArchivableSegments(
  channelId: string | null,
  dmChannelId: string | null,
  olderThanDays: number = 30,
  limit: number = 10
): Promise<MessageSegment[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  
  if (channelId) {
    return db.sql`
      SELECT * FROM message_segments
      WHERE channel_id = ${channelId}
        AND is_archived = false
        AND segment_end < ${cutoff}
      ORDER BY segment_start ASC
      LIMIT ${limit}
    ` as Promise<MessageSegment[]>;
  } else if (dmChannelId) {
    return db.sql`
      SELECT * FROM message_segments
      WHERE dm_channel_id = ${dmChannelId}
        AND is_archived = false
        AND segment_end < ${cutoff}
      ORDER BY segment_start ASC
      LIMIT ${limit}
    ` as Promise<MessageSegment[]>;
  }
  
  return [];
}

/**
 * Check if a timestamp falls within an archived segment.
 */
export async function isTimestampInArchivedSegment(
  channelId: string | null,
  dmChannelId: string | null,
  timestamp: Date
): Promise<{ isArchived: boolean; segment: MessageSegment | null }> {
  const segment = await db.segments.findByTimestamp(channelId, dmChannelId, timestamp);
  
  if (!segment) {
    return { isArchived: false, segment: null };
  }
  
  return { 
    isArchived: segment.is_archived, 
    segment: segment as MessageSegment 
  };
}
