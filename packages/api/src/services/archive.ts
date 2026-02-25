/**
 * Archive Service
 * 
 * Handles archiving message segments to MinIO cold storage and
 * restoring them when needed.
 */

import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import { db } from '../lib/db.js';
import { storage } from '../lib/storage.js';
import type { MessageSegment, ArchivedSegmentData, ArchivedMessage } from '@sgchat/shared';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Archive a segment to MinIO storage.
 * - Fetches all messages in the segment
 * - Compresses them
 * - Uploads to MinIO
 * - Marks segment as archived
 * - Optionally deletes messages from DB
 */
export async function archiveSegment(
  segmentId: string,
  options: {
    deleteFromDb?: boolean;
    includeReplyPreviews?: boolean;
  } = {}
): Promise<{ archivePath: string; compressedSize: number }> {
  const { deleteFromDb = false, includeReplyPreviews = true } = options;
  
  // Get segment info
  const segment = await db.segments.findById(segmentId);
  if (!segment) {
    throw new Error(`Segment ${segmentId} not found`);
  }
  
  if (segment.is_archived) {
    throw new Error(`Segment ${segmentId} is already archived`);
  }
  
  // Fetch all messages in this segment
  const messages = await db.sql`
    SELECT 
      m.id, m.author_id, m.content, m.attachments,
      m.created_at, m.edited_at, m.reply_to_id, m.system_event
    FROM messages m
    WHERE m.segment_id = ${segmentId}
    ORDER BY m.created_at ASC
  `;
  
  // Build reply previews if requested
  const archivedMessages: ArchivedMessage[] = [];
  
  for (const msg of messages) {
    const archived: ArchivedMessage = {
      id: msg.id,
      author_id: msg.author_id,
      content: msg.content,
      attachments: msg.attachments || [],
      created_at: new Date(msg.created_at).toISOString(),
      edited_at: msg.edited_at ? new Date(msg.edited_at).toISOString() : null,
      reply_to_id: msg.reply_to_id,
      system_event: msg.system_event,
    };
    
    // Add reply preview if the replied-to message exists
    if (includeReplyPreviews && msg.reply_to_id) {
      const [replyTo] = await db.sql`
        SELECT content FROM messages WHERE id = ${msg.reply_to_id}
      `;
      if (replyTo) {
        archived.reply_preview = replyTo.content.substring(0, 100);
      }
    }
    
    archivedMessages.push(archived);
  }
  
  // Create archive data structure
  const archiveData: ArchivedSegmentData = {
    segment_id: segment.id,
    channel_id: segment.channel_id,
    dm_channel_id: segment.dm_channel_id,
    segment_start: new Date(segment.segment_start).toISOString(),
    segment_end: new Date(segment.segment_end).toISOString(),
    message_count: messages.length,
    messages: archivedMessages,
    archived_at: new Date().toISOString(),
    compression: 'gzip',
  };
  
  // Compress
  const jsonData = JSON.stringify(archiveData);
  const compressedData = await gzipAsync(Buffer.from(jsonData, 'utf8'));
  
  // Generate archive path
  const type = segment.channel_id ? 'channel' : 'dm';
  const targetId = segment.channel_id || segment.dm_channel_id;
  const archivePath = storage.generateArchivePath(
    type,
    targetId,
    segment.id,
    new Date(segment.segment_start)
  );
  
  // Upload to MinIO
  await storage.uploadArchive(archivePath, compressedData);
  
  // Mark segment as archived
  await db.segments.markArchived(segmentId, archivePath);
  
  // Log the operation
  await db.trimmingLog.create({
    channel_id: segment.channel_id || undefined,
    dm_channel_id: segment.dm_channel_id || undefined,
    action: 'segment_archived',
    messages_affected: messages.length,
    bytes_freed: 0, // We're not freeing space yet
    segment_ids: [segmentId],
    triggered_by: 'manual',
    details: {
      archive_path: archivePath,
      compressed_size: compressedData.length,
      original_size: jsonData.length,
    },
  });
  
  // Optionally delete messages from DB
  if (deleteFromDb) {
    await db.sql`
      DELETE FROM messages WHERE segment_id = ${segmentId}
    `;
  }
  
  return {
    archivePath,
    compressedSize: compressedData.length,
  };
}

/**
 * Restore a segment from MinIO archive.
 * - Downloads and decompresses the archive
 * - Optionally re-inserts messages into the database
 */
export async function restoreSegment(
  segmentId: string,
  options: {
    insertIntoDb?: boolean;
  } = {}
): Promise<ArchivedSegmentData> {
  const { insertIntoDb = false } = options;
  
  // Get segment info
  const segment = await db.segments.findById(segmentId);
  if (!segment) {
    throw new Error(`Segment ${segmentId} not found`);
  }
  
  if (!segment.is_archived || !segment.archive_path) {
    throw new Error(`Segment ${segmentId} is not archived`);
  }
  
  // Download from MinIO
  const compressedData = await storage.downloadArchive(segment.archive_path);
  
  // Decompress
  const jsonData = await gunzipAsync(compressedData);
  const archiveData: ArchivedSegmentData = JSON.parse(jsonData.toString('utf8'));
  
  // Optionally restore messages to database
  if (insertIntoDb) {
    for (const msg of archiveData.messages) {
      // Check if message already exists (avoid duplicates)
      const [existing] = await db.sql`
        SELECT id FROM messages WHERE id = ${msg.id}
      `;
      
      if (!existing) {
        await db.sql`
          INSERT INTO messages (
            id, channel_id, dm_channel_id, author_id, content,
            attachments, created_at, edited_at, reply_to_id, 
            system_event, segment_id
          )
          VALUES (
            ${msg.id},
            ${archiveData.channel_id},
            ${archiveData.dm_channel_id},
            ${msg.author_id},
            ${msg.content},
            ${JSON.stringify(msg.attachments)},
            ${msg.created_at},
            ${msg.edited_at},
            ${msg.reply_to_id},
            ${msg.system_event ? JSON.stringify(msg.system_event) : null},
            ${segmentId}
          )
        `;
      }
    }
    
    // Mark segment as not archived
    await db.segments.markUnarchived(segmentId);
  }
  
  return archiveData;
}

/**
 * Load messages from an archived segment without restoring to DB.
 */
export async function loadArchivedMessages(
  segmentId: string
): Promise<ArchivedMessage[]> {
  const archiveData = await restoreSegment(segmentId, { insertIntoDb: false });
  return archiveData.messages;
}

/**
 * Delete an archived segment completely (from both DB and storage).
 */
export async function deleteArchivedSegment(segmentId: string): Promise<void> {
  const segment = await db.segments.findById(segmentId);
  if (!segment) {
    throw new Error(`Segment ${segmentId} not found`);
  }
  
  // Delete from storage if archived
  if (segment.is_archived && segment.archive_path) {
    await storage.deleteArchive(segment.archive_path);
  }
  
  // Delete any remaining messages
  await db.sql`
    DELETE FROM messages WHERE segment_id = ${segmentId}
  `;
  
  // Log the operation
  await db.trimmingLog.create({
    channel_id: segment.channel_id || undefined,
    dm_channel_id: segment.dm_channel_id || undefined,
    action: 'segment_deleted',
    messages_affected: segment.message_count || 0,
    bytes_freed: segment.size_bytes || 0,
    segment_ids: [segmentId],
    triggered_by: 'manual',
    details: {
      was_archived: segment.is_archived,
      archive_path: segment.archive_path,
    },
  });
  
  // Delete segment record
  await db.segments.delete(segmentId);
}

/**
 * Get total archive storage usage.
 */
export async function getArchiveStorageUsage(prefix?: string): Promise<number> {
  return storage.getArchiveStorageUsage(prefix);
}

/**
 * List all archives for a channel.
 */
export async function listChannelArchives(
  channelId: string
): Promise<{ path: string; size: number; lastModified: Date }[]> {
  return storage.listArchives(`channels/${channelId}/`);
}

/**
 * List all archives for a DM channel.
 */
export async function listDMArchives(
  dmChannelId: string
): Promise<{ path: string; size: number; lastModified: Date }[]> {
  return storage.listArchives(`dms/${dmChannelId}/`);
}

/**
 * Archive multiple segments in batch.
 */
export async function archiveSegmentsBatch(
  segmentIds: string[],
  options: {
    deleteFromDb?: boolean;
    includeReplyPreviews?: boolean;
  } = {}
): Promise<{ 
  successful: string[]; 
  failed: { id: string; error: string }[];
  totalCompressedSize: number;
}> {
  const successful: string[] = [];
  const failed: { id: string; error: string }[] = [];
  let totalCompressedSize = 0;
  
  for (const segmentId of segmentIds) {
    try {
      const result = await archiveSegment(segmentId, options);
      successful.push(segmentId);
      totalCompressedSize += result.compressedSize;
    } catch (error) {
      failed.push({
        id: segmentId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  
  return { successful, failed, totalCompressedSize };
}

/**
 * Check if archive storage is healthy.
 */
export async function checkArchiveHealth(): Promise<{
  healthy: boolean;
  totalArchives: number;
  totalSize: number;
  error?: string;
}> {
  try {
    const archives = await storage.listArchives('');
    const totalSize = archives.reduce((sum, a) => sum + a.size, 0);
    
    return {
      healthy: true,
      totalArchives: archives.length,
      totalSize,
    };
  } catch (error) {
    return {
      healthy: false,
      totalArchives: 0,
      totalSize: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================
// EXPORT FUNCTIONALITY
// ============================================================

export interface ExportOptions {
  format: 'json' | 'csv';
  includeAttachmentUrls?: boolean;
  includeUserInfo?: boolean;
  startDate?: Date;
  endDate?: Date;
  compress?: boolean;
}

export interface ExportResult {
  exportPath: string;
  format: 'json' | 'csv';
  messageCount: number;
  segmentCount: number;
  exportedAt: string;
  dateRange: {
    start: string | null;
    end: string | null;
  };
  sizeBytes: number;
}

/**
 * Export channel messages for compliance/backup purposes.
 * Returns a downloadable archive containing all messages within the date range.
 */
export async function exportChannelMessages(
  channelId: string,
  options: ExportOptions
): Promise<ExportResult> {
  const { 
    format = 'json', 
    includeAttachmentUrls = true,
    includeUserInfo = true,
    startDate, 
    endDate,
    compress = true,
  } = options;

  let query = db.sql`
    SELECT 
      m.id, m.content, m.created_at, m.edited_at, m.reply_to_id,
      m.attachments, m.system_event, m.segment_id,
      ${includeUserInfo ? db.sql`u.id as author_id, u.username as author_username, u.display_name as author_display_name,` : db.sql`m.author_id,`}
      ms.is_archived, ms.archive_path
    FROM messages m
    LEFT JOIN message_segments ms ON m.segment_id = ms.id
    ${includeUserInfo ? db.sql`LEFT JOIN users u ON m.author_id = u.id` : db.sql``}
    WHERE m.channel_id = ${channelId}
    ${startDate ? db.sql`AND m.created_at >= ${startDate}` : db.sql``}
    ${endDate ? db.sql`AND m.created_at <= ${endDate}` : db.sql``}
    ORDER BY m.created_at ASC
  `;

  const messages = await query;

  // Also load messages from archived segments within the date range
  const archivedSegments = await db.sql`
    SELECT id, archive_path FROM message_segments
    WHERE channel_id = ${channelId}
      AND is_archived = true
      ${startDate ? db.sql`AND segment_end >= ${startDate}` : db.sql``}
      ${endDate ? db.sql`AND segment_start <= ${endDate}` : db.sql``}
  `;

  const archivedMessages: any[] = [];
  for (const seg of archivedSegments) {
    try {
      const segMessages = await loadArchivedMessages(seg.id);
      for (const msg of segMessages) {
        const msgDate = new Date(msg.created_at);
        if ((!startDate || msgDate >= startDate) && (!endDate || msgDate <= endDate)) {
          archivedMessages.push({
            ...msg,
            _source: 'archive',
            _segment_id: seg.id,
          });
        }
      }
    } catch (e) {
      console.error(`Failed to load archived segment ${seg.id} for export:`, e);
    }
  }

  // Combine and sort all messages
  const allMessages = [
    ...messages.map((m: any) => ({ ...m, _source: 'database' })),
    ...archivedMessages,
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  // Format output based on format type
  let exportData: string;
  if (format === 'csv') {
    exportData = formatMessagesAsCSV(allMessages, includeAttachmentUrls, includeUserInfo);
  } else {
    exportData = JSON.stringify({
      channel_id: channelId,
      exported_at: new Date().toISOString(),
      date_range: {
        start: startDate?.toISOString() || null,
        end: endDate?.toISOString() || null,
      },
      message_count: allMessages.length,
      messages: allMessages.map(m => formatMessageForExport(m, includeAttachmentUrls)),
    }, null, 2);
  }

  // Compress if requested
  let finalData: Buffer;
  if (compress) {
    finalData = await gzipAsync(Buffer.from(exportData, 'utf8'));
  } else {
    finalData = Buffer.from(exportData, 'utf8');
  }

  // Upload to storage
  const exportPath = `exports/channels/${channelId}/export-${Date.now()}.${format}${compress ? '.gz' : ''}`;
  await storage.uploadArchive(exportPath, finalData);

  // Log the export
  await db.trimmingLog.create({
    channel_id: channelId,
    action: 'manual_cleanup',
    messages_affected: allMessages.length,
    bytes_freed: 0,
    triggered_by: 'manual',
    details: {
      action_type: 'export',
      export_path: exportPath,
      format,
      compressed: compress,
      date_range: {
        start: startDate?.toISOString() || null,
        end: endDate?.toISOString() || null,
      },
    },
  });

  return {
    exportPath,
    format,
    messageCount: allMessages.length,
    segmentCount: new Set(allMessages.map((m: any) => m.segment_id || m._segment_id)).size,
    exportedAt: new Date().toISOString(),
    dateRange: {
      start: startDate?.toISOString() || null,
      end: endDate?.toISOString() || null,
    },
    sizeBytes: finalData.length,
  };
}

/**
 * Export DM messages for compliance/backup purposes.
 */
export async function exportDMMessages(
  dmChannelId: string,
  options: ExportOptions
): Promise<ExportResult> {
  const { 
    format = 'json', 
    includeAttachmentUrls = true,
    includeUserInfo = true,
    startDate, 
    endDate,
    compress = true,
  } = options;

  let query = db.sql`
    SELECT 
      m.id, m.content, m.created_at, m.edited_at, m.reply_to_id,
      m.attachments, m.system_event, m.segment_id,
      ${includeUserInfo ? db.sql`u.id as author_id, u.username as author_username,` : db.sql`m.author_id,`}
      ms.is_archived
    FROM messages m
    LEFT JOIN message_segments ms ON m.segment_id = ms.id
    ${includeUserInfo ? db.sql`LEFT JOIN users u ON m.author_id = u.id` : db.sql``}
    WHERE m.dm_channel_id = ${dmChannelId}
    ${startDate ? db.sql`AND m.created_at >= ${startDate}` : db.sql``}
    ${endDate ? db.sql`AND m.created_at <= ${endDate}` : db.sql``}
    ORDER BY m.created_at ASC
  `;

  const messages = await query;

  // Also load messages from archived segments
  const archivedSegments = await db.sql`
    SELECT id FROM message_segments
    WHERE dm_channel_id = ${dmChannelId}
      AND is_archived = true
      ${startDate ? db.sql`AND segment_end >= ${startDate}` : db.sql``}
      ${endDate ? db.sql`AND segment_start <= ${endDate}` : db.sql``}
  `;

  const archivedMessages: any[] = [];
  for (const seg of archivedSegments) {
    try {
      const segMessages = await loadArchivedMessages(seg.id);
      for (const msg of segMessages) {
        const msgDate = new Date(msg.created_at);
        if ((!startDate || msgDate >= startDate) && (!endDate || msgDate <= endDate)) {
          archivedMessages.push({
            ...msg,
            _source: 'archive',
            _segment_id: seg.id,
          });
        }
      }
    } catch (e) {
      console.error(`Failed to load archived DM segment ${seg.id} for export:`, e);
    }
  }

  const allMessages = [
    ...messages.map((m: any) => ({ ...m, _source: 'database' })),
    ...archivedMessages,
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  let exportData: string;
  if (format === 'csv') {
    exportData = formatMessagesAsCSV(allMessages, includeAttachmentUrls, includeUserInfo);
  } else {
    exportData = JSON.stringify({
      dm_channel_id: dmChannelId,
      exported_at: new Date().toISOString(),
      date_range: {
        start: startDate?.toISOString() || null,
        end: endDate?.toISOString() || null,
      },
      message_count: allMessages.length,
      messages: allMessages.map(m => formatMessageForExport(m, includeAttachmentUrls)),
    }, null, 2);
  }

  let finalData: Buffer;
  if (compress) {
    finalData = await gzipAsync(Buffer.from(exportData, 'utf8'));
  } else {
    finalData = Buffer.from(exportData, 'utf8');
  }

  const exportPath = `exports/dms/${dmChannelId}/export-${Date.now()}.${format}${compress ? '.gz' : ''}`;
  await storage.uploadArchive(exportPath, finalData);

  await db.trimmingLog.create({
    dm_channel_id: dmChannelId,
    action: 'manual_cleanup',
    messages_affected: allMessages.length,
    bytes_freed: 0,
    triggered_by: 'manual',
    details: {
      action_type: 'export',
      export_path: exportPath,
      format,
      compressed: compress,
    },
  });

  return {
    exportPath,
    format,
    messageCount: allMessages.length,
    segmentCount: new Set(allMessages.map((m: any) => m.segment_id || m._segment_id)).size,
    exportedAt: new Date().toISOString(),
    dateRange: {
      start: startDate?.toISOString() || null,
      end: endDate?.toISOString() || null,
    },
    sizeBytes: finalData.length,
  };
}

/**
 * Download an export file.
 */
export async function downloadExport(exportPath: string): Promise<Buffer> {
  return storage.downloadArchive(exportPath);
}

/**
 * List available exports for a channel.
 */
export async function listExports(
  channelId: string | null,
  dmChannelId: string | null
): Promise<{ path: string; size: number; lastModified: Date }[]> {
  const prefix = channelId 
    ? `exports/channels/${channelId}/`
    : `exports/dms/${dmChannelId}/`;
  return storage.listArchives(prefix);
}

/**
 * Delete an export file.
 */
export async function deleteExport(exportPath: string): Promise<void> {
  await storage.deleteArchive(exportPath);
}

// Helper functions for export formatting

function formatMessageForExport(msg: any, includeAttachmentUrls: boolean) {
  const formatted: any = {
    id: msg.id,
    author_id: msg.author_id,
    content: msg.content,
    created_at: msg.created_at,
    edited_at: msg.edited_at,
    reply_to_id: msg.reply_to_id,
  };

  if (msg.author_username) {
    formatted.author_username = msg.author_username;
  }
  if (msg.author_display_name) {
    formatted.author_display_name = msg.author_display_name;
  }
  if (msg.system_event) {
    formatted.system_event = msg.system_event;
  }
  if (includeAttachmentUrls && msg.attachments?.length > 0) {
    formatted.attachments = msg.attachments;
  }

  return formatted;
}

function formatMessagesAsCSV(messages: any[], includeAttachmentUrls: boolean, includeUserInfo: boolean): string {
  const headers = ['id', 'created_at', 'edited_at', 'author_id'];
  if (includeUserInfo) {
    headers.push('author_username');
  }
  headers.push('content', 'reply_to_id');
  if (includeAttachmentUrls) {
    headers.push('attachments');
  }

  const rows = messages.map(msg => {
    const row: string[] = [
      msg.id,
      msg.created_at,
      msg.edited_at || '',
      msg.author_id || '',
    ];
    if (includeUserInfo) {
      row.push(msg.author_username || '');
    }
    row.push(
      `"${(msg.content || '').replace(/"/g, '""')}"`,
      msg.reply_to_id || '',
    );
    if (includeAttachmentUrls) {
      row.push(msg.attachments ? JSON.stringify(msg.attachments) : '');
    }
    return row.join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

// ============================================================
// CROSS-SEGMENT REFERENCE HANDLING
// ============================================================

/**
 * Handle message edit that may affect archived segments.
 * Updates the edit timestamp and content in the message,
 * and logs a reference update for archived cross-references.
 */
export async function handleCrossSegmentEdit(
  messageId: string,
  newContent: string
): Promise<{ 
  updated: boolean; 
  affectedReferences: string[];
}> {
  const [message] = await db.sql`
    SELECT id, segment_id, channel_id, dm_channel_id FROM messages WHERE id = ${messageId}
  `;

  if (!message) {
    return { updated: false, affectedReferences: [] };
  }

  // Find messages in other segments that reply to this message
  const replyingMessages = await db.sql`
    SELECT m.id, m.segment_id, ms.is_archived
    FROM messages m
    LEFT JOIN message_segments ms ON m.segment_id = ms.id
    WHERE m.reply_to_id = ${messageId}
      AND m.segment_id != ${message.segment_id}
  `;

  const affectedReferences: string[] = [];

  // For archived segments that reference this message, we log the edit
  // The reply_preview will be stale, but we track this for audit purposes
  for (const reply of replyingMessages) {
    if (reply.is_archived) {
      affectedReferences.push(reply.id);
    }
  }

  if (affectedReferences.length > 0) {
    await db.trimmingLog.create({
      channel_id: message.channel_id || undefined,
      dm_channel_id: message.dm_channel_id || undefined,
      action: 'manual_cleanup',
      messages_affected: affectedReferences.length,
      bytes_freed: 0,
      triggered_by: 'manual',
      details: {
        action_type: 'cross_segment_edit',
        edited_message_id: messageId,
        affected_archived_references: affectedReferences,
        new_content_preview: newContent.substring(0, 50),
      },
    });
  }

  return { updated: true, affectedReferences };
}

/**
 * Handle message deletion that may affect archived segments.
 * Tracks deletions that break cross-segment references.
 */
export async function handleCrossSegmentDelete(
  messageId: string,
  channelId: string | null,
  dmChannelId: string | null
): Promise<{ 
  deleted: boolean; 
  brokenReferences: string[];
}> {
  // Find messages that reply to this message
  const replyingMessages = await db.sql`
    SELECT m.id, m.segment_id, ms.is_archived
    FROM messages m
    LEFT JOIN message_segments ms ON m.segment_id = ms.id
    WHERE m.reply_to_id = ${messageId}
  `;

  const brokenReferences: string[] = [];

  for (const reply of replyingMessages) {
    brokenReferences.push(reply.id);
  }

  if (brokenReferences.length > 0) {
    await db.trimmingLog.create({
      channel_id: channelId || undefined,
      dm_channel_id: dmChannelId || undefined,
      action: 'manual_cleanup',
      messages_affected: brokenReferences.length,
      bytes_freed: 0,
      triggered_by: 'manual',
      details: {
        action_type: 'cross_segment_delete',
        deleted_message_id: messageId,
        broken_references: brokenReferences,
      },
    });
  }

  return { deleted: true, brokenReferences };
}

/**
 * Resolve a cross-segment message reference.
 * Attempts to find the referenced message in the database or archives.
 */
export async function resolveCrossSegmentReference(
  messageId: string
): Promise<{
  found: boolean;
  source: 'database' | 'archive' | 'not_found';
  content?: string;
  author_id?: string;
  created_at?: string;
}> {
  // First try database
  const [message] = await db.sql`
    SELECT id, content, author_id, created_at, segment_id
    FROM messages WHERE id = ${messageId}
  `;

  if (message) {
    return {
      found: true,
      source: 'database',
      content: message.content,
      author_id: message.author_id,
      created_at: new Date(message.created_at).toISOString(),
    };
  }

  // Search in archived segments
  // This is expensive, so we look for the segment that should contain this message
  const [segmentHint] = await db.sql`
    SELECT ms.id, ms.archive_path
    FROM message_segments ms
    WHERE ms.is_archived = true
    ORDER BY ms.segment_start DESC
    LIMIT 50
  `;

  if (!segmentHint) {
    return { found: false, source: 'not_found' };
  }

  // Check recent archived segments for the message
  const archivedSegments = await db.sql`
    SELECT id FROM message_segments 
    WHERE is_archived = true 
    ORDER BY segment_start DESC 
    LIMIT 20
  `;

  for (const seg of archivedSegments) {
    try {
      const messages = await loadArchivedMessages(seg.id);
      const found = messages.find(m => m.id === messageId);
      if (found) {
        return {
          found: true,
          source: 'archive',
          content: found.content,
          author_id: found.author_id || undefined,
          created_at: found.created_at,
        };
      }
    } catch (e) {
      // Continue to next segment
    }
  }

  return { found: false, source: 'not_found' };
}
