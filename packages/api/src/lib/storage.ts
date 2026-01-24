import { Client } from 'minio';
import { nanoid } from 'nanoid';

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost:9000';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'sgchat-files';

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
};
