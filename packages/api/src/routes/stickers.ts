import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { storage } from '../lib/storage.js';
import { publishEvent } from '../lib/eventBus.js';
import { calculatePermissions } from '../services/permissions.js';
import { ServerPermissions, hasPermission } from '@sgchat/shared';
import { notFound, badRequest, forbidden } from '../utils/errors.js';
import { nanoid } from 'nanoid';
import { extractFileData } from './upload.js';

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/apng': 'apng',
};

const MAX_STICKER_SIZE = 512 * 1024; // 512KB
const MAX_STICKERS_PER_SERVER = 50;

export const stickerRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /servers/:serverId/stickers - List all stickers for a server
  fastify.get('/:serverId/stickers', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const stickers = await db.stickers.findByServer(serverId);
      return { stickers };
    },
  });

  // POST /servers/:serverId/stickers - Upload a new sticker
  fastify.post('/:serverId/stickers', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    bodyLimit: 2 * 1024 * 1024, // 2MB for encrypted uploads (base64 overhead)
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      // Check MANAGE_STICKERS permission
      const perms = await calculatePermissions(request.user!.id, serverId);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_STICKERS)) {
        return forbidden(reply, 'Missing MANAGE_STICKERS permission');
      }

      // Check sticker count limit
      const stickerCount = await db.stickers.countByServer(serverId);
      if (stickerCount >= MAX_STICKERS_PER_SERVER) {
        return badRequest(reply, `Server can have at most ${MAX_STICKERS_PER_SERVER} stickers`);
      }

      const fileData = await extractFileData(request);
      if (!fileData) return badRequest(reply, 'No file uploaded');

      const { buffer, filename, mimetype, fields } = fileData;

      const fileType = ALLOWED_IMAGE_TYPES[mimetype];
      if (!fileType) {
        return badRequest(reply, `Image type not allowed: ${mimetype}. Allowed: png, gif, webp, apng`);
      }

      if (buffer.length > MAX_STICKER_SIZE) {
        return badRequest(reply, `File too large. Maximum size is ${MAX_STICKER_SIZE / 1024}KB`);
      }

      // Get name and description from form fields
      const name = (fields.name || filename.replace(/\.[^/.]+$/, '')).slice(0, 30);
      if (name.length < 2) {
        return badRequest(reply, 'Sticker name must be at least 2 characters');
      }
      const description = fields.description ? fields.description.slice(0, 100) : null;

      // Upload to storage
      const storagePath = `stickers/${serverId}/${nanoid(12)}.${fileType}`;
      const url = await storage.uploadFile(buffer, storagePath, mimetype);

      const sticker = await db.stickers.create({
        server_id: serverId,
        name,
        description,
        file_url: url,
        file_type: fileType,
        uploaded_by: request.user!.id,
      });

      // Notify server members
      await publishEvent({
        type: 'sticker.added',
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: { sticker },
      });

      return sticker;
    },
  });

  // DELETE /servers/:serverId/stickers/:stickerId
  fastify.delete('/:serverId/stickers/:stickerId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId, stickerId } = request.params as { serverId: string; stickerId: string };

      const sticker = await db.stickers.findById(stickerId);
      if (!sticker || sticker.server_id !== serverId) return notFound(reply, 'Sticker');

      // Check MANAGE_STICKERS permission
      const perms = await calculatePermissions(request.user!.id, serverId);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_STICKERS)) {
        return forbidden(reply, 'Missing MANAGE_STICKERS permission');
      }

      await db.stickers.delete(stickerId);

      await publishEvent({
        type: 'sticker.removed',
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: { sticker_id: stickerId },
      });

      return { message: 'Sticker deleted' };
    },
  });
};
