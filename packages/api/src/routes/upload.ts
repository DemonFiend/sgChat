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

/**
 * Extract file data from either multipart upload or encrypted JSON body.
 * When crypto session is active, clients send { _fileUpload, filename, mimetype, data: base64 }
 * which the crypto plugin decrypts before the handler runs.
 *
 * Exported so other upload routes (avatar, soundboard, voice sounds) can reuse.
 */
export async function extractFileData(
  request: any,
): Promise<{
  buffer: Buffer;
  filename: string;
  mimetype: string;
  fields: Record<string, string>;
} | null> {
  const body = request.body as any;

  // Encrypted file upload: JSON body with base64 file data (already decrypted by crypto plugin)
  if (body && body._fileUpload && typeof body.data === 'string') {
    const buffer = Buffer.from(body.data, 'base64');
    // Extra fields sent alongside the file (e.g., name, duration, emoji)
    const fields: Record<string, string> = {};
    if (body.fields && typeof body.fields === 'object') {
      for (const [k, v] of Object.entries(body.fields)) {
        fields[k] = String(v);
      }
    }
    return {
      buffer,
      filename: body.filename || 'upload',
      mimetype: body.mimetype || 'application/octet-stream',
      fields,
    };
  }

  // Standard multipart upload
  const data = await request.file().catch(() => null);
  if (!data) return null;

  const buffer = await data.toBuffer();
  // Extract multipart form fields
  const fields: Record<string, string> = {};
  const rawFields = data.fields as any;
  if (rawFields) {
    for (const [k, v] of Object.entries(rawFields)) {
      if (v && typeof v === 'object' && 'value' in (v as any)) {
        fields[k] = String((v as any).value);
      }
    }
  }

  return {
    buffer,
    filename: data.filename,
    mimetype: data.mimetype,
    fields,
  };
}

export const uploadRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /upload
   * General file upload endpoint
   * Accepts both multipart/form-data and encrypted JSON file uploads
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
    bodyLimit: 15 * 1024 * 1024, // 15MB for encrypted uploads (base64 overhead)
    handler: async (request, reply) => {
      const fileData = await extractFileData(request);

      if (!fileData) {
        return badRequest(reply, 'No file uploaded');
      }

      const { buffer, filename, mimetype } = fileData;

      // Check file size
      if (buffer.length > MAX_FILE_SIZE) {
        return badRequest(reply, `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
      }

      // Check content type
      if (!ALLOWED_FILE_TYPES.includes(mimetype)) {
        return badRequest(reply, `File type not allowed: ${mimetype}`);
      }

      // Validate actual file content matches declared MIME type (magic number check)
      if (!await validateFileContent(buffer, mimetype)) {
        return badRequest(reply, 'File content does not match declared type');
      }

      // Generate unique filename
      const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 100);
      const uniqueId = nanoid(12);
      const storagePath = `uploads/${request.user!.id}/${uniqueId}-${safeFilename}`;

      // Upload to storage
      const url = await storage.uploadFile(buffer, storagePath, mimetype);

      return {
        url,
        filename,
        size: buffer.length,
        content_type: mimetype,
      };
    },
  });

  /**
   * POST /upload/image
   * Image-specific upload (for chat embeds, etc.)
   * Accepts both multipart/form-data and encrypted JSON file uploads
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
    bodyLimit: 10 * 1024 * 1024, // 10MB for encrypted image uploads
    handler: async (request, reply) => {
      const fileData = await extractFileData(request);

      if (!fileData) {
        return badRequest(reply, 'No file uploaded');
      }

      const { buffer, filename, mimetype } = fileData;

      // Check content type is an image
      if (!ALLOWED_IMAGE_TYPES.includes(mimetype)) {
        return badRequest(reply, `Only images allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}`);
      }

      // Check file size (5MB for images)
      const maxImageSize = 5 * 1024 * 1024;
      if (buffer.length > maxImageSize) {
        return badRequest(reply, `Image too large. Maximum size is 5MB`);
      }

      // Validate actual file content matches declared MIME type (magic number check)
      if (!await validateFileContent(buffer, mimetype)) {
        return badRequest(reply, 'File content does not match declared image type');
      }

      // Generate unique filename
      const ext = mimetype.split('/')[1] || 'png';
      const uniqueId = nanoid(12);
      const storagePath = `images/${request.user!.id}/${uniqueId}.${ext}`;

      // Upload to storage
      const url = await storage.uploadFile(buffer, storagePath, mimetype);

      return {
        url,
        filename,
        size: buffer.length,
        content_type: mimetype,
      };
    },
  });
};
