import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { storage } from '../lib/storage.js';
import { badRequest } from '../utils/errors.js';
import { nanoid } from 'nanoid';
import { fileTypeFromBuffer } from 'file-type';

// Max file size: 10MB for general uploads
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed MIME types
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_FILE_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  'application/pdf',
  'application/zip',
  'text/plain',
  'text/markdown',
  'application/json',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'video/mp4',
  'video/webm',
];

// MIME types that can be verified via magic number (binary file headers)
// Text-based types (text/plain, text/markdown, application/json) cannot be detected
const MAGIC_DETECTABLE = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'application/zip',
  'audio/mpeg', 'audio/wav', 'audio/ogg',
  'video/mp4', 'video/webm',
]);

/**
 * Validate that file content matches the declared MIME type using magic numbers.
 * Prevents uploading disguised executables (e.g., .exe renamed to .jpg).
 */
async function validateFileContent(buffer: Buffer, declaredMime: string): Promise<boolean> {
  if (!MAGIC_DETECTABLE.has(declaredMime)) return true;
  const detected = await fileTypeFromBuffer(buffer);
  return detected?.mime === declaredMime;
}

export const uploadRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /upload
   * General file upload endpoint
   * Returns: { url: string, filename: string, size: number, content_type: string }
   */
  fastify.post('/upload', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
      },
    },
    handler: async (request, reply) => {
      const data = await request.file();
      
      if (!data) {
        return badRequest(reply, 'No file uploaded');
      }

      // Check file size
      const buffer = await data.toBuffer();
      if (buffer.length > MAX_FILE_SIZE) {
        return badRequest(reply, `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
      }

      // Check content type
      if (!ALLOWED_FILE_TYPES.includes(data.mimetype)) {
        return badRequest(reply, `File type not allowed: ${data.mimetype}`);
      }

      // Validate actual file content matches declared MIME type (magic number check)
      if (!await validateFileContent(buffer, data.mimetype)) {
        return badRequest(reply, 'File content does not match declared type');
      }

      // Generate unique filename
      const ext = data.filename.split('.').pop() || 'bin';
      const safeFilename = data.filename.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 100);
      const uniqueId = nanoid(12);
      const storagePath = `uploads/${request.user!.id}/${uniqueId}-${safeFilename}`;

      // Upload to storage
      const url = await storage.uploadFile(buffer, storagePath, data.mimetype);

      return {
        url,
        filename: data.filename,
        size: buffer.length,
        content_type: data.mimetype,
      };
    },
  });

  /**
   * POST /upload/image
   * Image-specific upload (for chat embeds, etc.)
   * Validates image types and optionally resizes
   */
  fastify.post('/upload/image', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
      },
    },
    handler: async (request, reply) => {
      const data = await request.file();
      
      if (!data) {
        return badRequest(reply, 'No file uploaded');
      }

      // Check content type is an image
      if (!ALLOWED_IMAGE_TYPES.includes(data.mimetype)) {
        return badRequest(reply, `Only images allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}`);
      }

      const buffer = await data.toBuffer();
      
      // Check file size (5MB for images)
      const maxImageSize = 5 * 1024 * 1024;
      if (buffer.length > maxImageSize) {
        return badRequest(reply, `Image too large. Maximum size is 5MB`);
      }

      // Validate actual file content matches declared MIME type (magic number check)
      if (!await validateFileContent(buffer, data.mimetype)) {
        return badRequest(reply, 'File content does not match declared image type');
      }

      // Generate unique filename
      const ext = data.mimetype.split('/')[1] || 'png';
      const uniqueId = nanoid(12);
      const storagePath = `images/${request.user!.id}/${uniqueId}.${ext}`;

      // Upload to storage
      const url = await storage.uploadFile(buffer, storagePath, data.mimetype);

      return {
        url,
        filename: data.filename,
        size: buffer.length,
        content_type: data.mimetype,
      };
    },
  });
};
