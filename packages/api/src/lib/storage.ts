import { Client } from 'minio';
import { nanoid } from 'nanoid';
import { Readable } from 'stream';

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost:9000';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'sgchat-files';
const MINIO_ARCHIVE_BUCKET = process.env.MINIO_ARCHIVE_BUCKET || 'sgchat-archives';

// Parse endpoint (host:port)
const [endpointHost, endpointPort] = MINIO_ENDPOINT.split(':');

const minioClient = new Client({
  endPoint: endpointHost,
  port: parseInt(endpointPort || '9000', 10),
  useSSL: false,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
});

export async function initStorage() {
  try {
    // Initialize main bucket
    const exists = await minioClient.bucketExists(MINIO_BUCKET);
    if (!exists) {
      await minioClient.makeBucket(MINIO_BUCKET);
      console.log(`✅ Created MinIO bucket: ${MINIO_BUCKET}`);
      
      // Set bucket policy to allow public read for avatars
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${MINIO_BUCKET}/avatars/*`],
          },
        ],
      };
      await minioClient.setBucketPolicy(MINIO_BUCKET, JSON.stringify(policy));
    }
    
    // Initialize archive bucket for message segments
    const archiveExists = await minioClient.bucketExists(MINIO_ARCHIVE_BUCKET);
    if (!archiveExists) {
      await minioClient.makeBucket(MINIO_ARCHIVE_BUCKET);
      console.log(`✅ Created MinIO archive bucket: ${MINIO_ARCHIVE_BUCKET}`);
    }
    
    console.log('✅ MinIO connected');
  } catch (error) {
    console.error('❌ MinIO connection failed:', error);
    throw error;
  }
}

export const storage = {
  /**
   * Upload a file to storage
   */
  async uploadFile(
    buffer: Buffer,
    path: string,
    contentType: string
  ): Promise<string> {
    await minioClient.putObject(MINIO_BUCKET, path, buffer, buffer.length, {
      'Content-Type': contentType,
    });
    
    // Return the public URL
    return `http://${MINIO_ENDPOINT}/${MINIO_BUCKET}/${path}`;
  },

  /**
   * Upload avatar image
   */
  async uploadAvatar(
    userId: string,
    buffer: Buffer,
    contentType: string
  ): Promise<string> {
    const ext = contentType.split('/')[1] || 'png';
    const filename = `${userId}-${nanoid(8)}.${ext}`;
    const path = `avatars/${filename}`;
    
    return this.uploadFile(buffer, path, contentType);
  },

  /**
   * Delete a file from storage
   */
  async deleteFile(path: string): Promise<void> {
    try {
      await minioClient.removeObject(MINIO_BUCKET, path);
    } catch (error) {
      console.error('Failed to delete file:', path, error);
    }
  },

  /**
   * Delete avatar by extracting path from URL
   */
  async deleteAvatar(avatarUrl: string): Promise<void> {
    if (!avatarUrl) return;
    
    try {
      // Extract path from URL: http://host/bucket/avatars/filename.ext
      const url = new URL(avatarUrl);
      const pathParts = url.pathname.split('/');
      // Remove empty string and bucket name
      const objectPath = pathParts.slice(2).join('/');
      await this.deleteFile(objectPath);
    } catch (error) {
      console.error('Failed to delete avatar:', avatarUrl, error);
    }
  },

  /**
   * Upload a generic attachment
   */
  async uploadAttachment(
    channelId: string,
    filename: string,
    buffer: Buffer,
    contentType: string
  ): Promise<string> {
    const safeFilename = `${nanoid(12)}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const path = `attachments/${channelId}/${safeFilename}`;
    
    return this.uploadFile(buffer, path, contentType);
  },

  // ============================================================
  // Avatar-specific methods (with slot-based storage)
  // ============================================================

  /**
   * Upload a processed avatar to a specific slot (current or previous).
   * Returns the storage path and public URL.
   */
  async uploadProcessedAvatar(
    userId: string,
    slot: 'current' | 'previous',
    buffer: Buffer
  ): Promise<{ path: string; url: string }> {
    const path = `avatars/${userId}-${slot}.webp`;
    const url = await this.uploadFile(buffer, path, 'image/webp');
    return { path, url };
  },

  /**
   * Delete avatar by slot.
   */
  async deleteAvatarBySlot(userId: string, slot: 'current' | 'previous'): Promise<void> {
    const path = `avatars/${userId}-${slot}.webp`;
    await this.deleteFile(path);
  },

  /**
   * Copy avatar from one slot to another (used for moving current to previous).
   * Returns the new path and URL, or null if source doesn't exist.
   */
  async copyAvatarSlot(
    userId: string,
    fromSlot: 'current' | 'previous',
    toSlot: 'current' | 'previous'
  ): Promise<{ path: string; url: string } | null> {
    const sourcePath = `avatars/${userId}-${fromSlot}.webp`;
    const destPath = `avatars/${userId}-${toSlot}.webp`;
    
    try {
      // Copy object in MinIO
      await minioClient.copyObject(
        MINIO_BUCKET,
        destPath,
        `/${MINIO_BUCKET}/${sourcePath}`
      );
      
      const url = `http://${MINIO_ENDPOINT}/${MINIO_BUCKET}/${destPath}`;
      return { path: destPath, url };
    } catch (error) {
      // Source doesn't exist or copy failed
      console.error('Failed to copy avatar slot:', error);
      return null;
    }
  },

  /**
   * Check if an avatar exists at a given slot.
   */
  async avatarSlotExists(userId: string, slot: 'current' | 'previous'): Promise<boolean> {
    const path = `avatars/${userId}-${slot}.webp`;
    try {
      await minioClient.statObject(MINIO_BUCKET, path);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Get the public URL for an avatar slot.
   */
  getAvatarUrl(userId: string, slot: 'current' | 'previous'): string {
    return `http://${MINIO_ENDPOINT}/${MINIO_BUCKET}/avatars/${userId}-${slot}.webp`;
  },

  /**
   * Get file size of an avatar at a given slot.
   */
  async getAvatarFileSize(userId: string, slot: 'current' | 'previous'): Promise<number | null> {
    const path = `avatars/${userId}-${slot}.webp`;
    try {
      const stat = await minioClient.statObject(MINIO_BUCKET, path);
      return stat.size;
    } catch {
      return null;
    }
  },

  // ============================================================
  // Archive storage methods (for message segment archiving)
  // ============================================================

  /**
   * Upload a compressed archive to the archive bucket.
   * @param archivePath - Path within the archive bucket (e.g., "channels/{id}/segment-{date}.json.gz")
   * @param data - Compressed data buffer
   * @returns The full path of the archived object
   */
  async uploadArchive(archivePath: string, data: Buffer): Promise<string> {
    await minioClient.putObject(MINIO_ARCHIVE_BUCKET, archivePath, data, data.length, {
      'Content-Type': 'application/gzip',
      'Content-Encoding': 'gzip',
    });
    return archivePath;
  },

  /**
   * Download an archive from the archive bucket.
   * @param archivePath - Path within the archive bucket
   * @returns The archive data as a Buffer
   */
  async downloadArchive(archivePath: string): Promise<Buffer> {
    const stream = await minioClient.getObject(MINIO_ARCHIVE_BUCKET, archivePath);
    const chunks: Buffer[] = [];
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  },

  /**
   * Delete an archive from the archive bucket.
   * @param archivePath - Path within the archive bucket
   */
  async deleteArchive(archivePath: string): Promise<void> {
    try {
      await minioClient.removeObject(MINIO_ARCHIVE_BUCKET, archivePath);
    } catch (error) {
      console.error('Failed to delete archive:', archivePath, error);
    }
  },

  /**
   * Check if an archive exists.
   * @param archivePath - Path within the archive bucket
   */
  async archiveExists(archivePath: string): Promise<boolean> {
    try {
      await minioClient.statObject(MINIO_ARCHIVE_BUCKET, archivePath);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Get the size of an archive.
   * @param archivePath - Path within the archive bucket
   */
  async getArchiveSize(archivePath: string): Promise<number | null> {
    try {
      const stat = await minioClient.statObject(MINIO_ARCHIVE_BUCKET, archivePath);
      return stat.size;
    } catch {
      return null;
    }
  },

  /**
   * List all archives for a channel or DM.
   * @param prefix - Prefix to filter (e.g., "channels/{id}/")
   */
  async listArchives(prefix: string): Promise<{ path: string; size: number; lastModified: Date }[]> {
    const archives: { path: string; size: number; lastModified: Date }[] = [];
    
    const stream = minioClient.listObjects(MINIO_ARCHIVE_BUCKET, prefix, true);
    
    return new Promise((resolve, reject) => {
      stream.on('data', (obj) => {
        if (obj.name && obj.size !== undefined && obj.lastModified) {
          archives.push({
            path: obj.name,
            size: obj.size,
            lastModified: obj.lastModified,
          });
        }
      });
      stream.on('end', () => resolve(archives));
      stream.on('error', reject);
    });
  },

  /**
   * Calculate total storage used in the archive bucket for a given prefix.
   * @param prefix - Prefix to filter (e.g., "channels/{id}/")
   */
  async getArchiveStorageUsage(prefix?: string): Promise<number> {
    let totalSize = 0;
    
    const stream = minioClient.listObjects(MINIO_ARCHIVE_BUCKET, prefix || '', true);
    
    return new Promise((resolve, reject) => {
      stream.on('data', (obj) => {
        totalSize += obj.size || 0;
      });
      stream.on('end', () => resolve(totalSize));
      stream.on('error', reject);
    });
  },

  /**
   * Generate the archive path for a segment.
   * @param type - 'channel' or 'dm'
   * @param targetId - Channel or DM channel ID
   * @param segmentId - Segment ID
   * @param segmentStart - Segment start date
   */
  generateArchivePath(
    type: 'channel' | 'dm',
    targetId: string,
    segmentId: string,
    segmentStart: Date
  ): string {
    const dateStr = segmentStart.toISOString().split('T')[0]; // YYYY-MM-DD
    return `${type}s/${targetId}/segment-${dateStr}-${segmentId}.json.gz`;
  },
};
