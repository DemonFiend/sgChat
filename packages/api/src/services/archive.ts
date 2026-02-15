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
