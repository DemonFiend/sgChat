import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db, sql } from '../lib/db.js';
import { storage } from '../lib/storage.js';
import { publishEvent } from '../lib/eventBus.js';
import { calculatePermissions } from '../services/permissions.js';
import { ServerPermissions, hasPermission } from '@sgchat/shared';
import { notFound, badRequest, forbidden } from '../utils/errors.js';
import { nanoid } from 'nanoid';

const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg'];

export const soundboardRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /servers/:serverId/soundboard - List all sounds
  fastify.get('/:serverId/soundboard', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const server = await db.servers.findById(serverId);
      if (!server) return notFound(reply, 'Server');

      const config = server.soundboard_config || {
        enabled: true,
        max_sounds_per_user: 3,
        max_sound_duration_seconds: 5,
        max_sound_size_bytes: 1048576,
      };

      if (!config.enabled) {
        return { sounds: [], config };
      }

      const sounds = await db.soundboard.findByServer(serverId);
      return { sounds, config };
    },
  });

  // POST /servers/:serverId/soundboard - Upload new sound
  fastify.post('/:serverId/soundboard', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const server = await db.servers.findById(serverId);
      if (!server) return notFound(reply, 'Server');

      const config = server.soundboard_config || {
        enabled: true,
        max_sounds_per_user: 3,
        max_sound_duration_seconds: 5,
        max_sound_size_bytes: 1048576,
      };

      if (!config.enabled) {
        return badRequest(reply, 'Soundboard is disabled for this server');
      }

      // Check user's sound count
      const userSoundCount = await db.soundboard.countByUploaderAndServer(request.user!.id, serverId);
      if (userSoundCount >= config.max_sounds_per_user) {
        return badRequest(reply, `You can only upload ${config.max_sounds_per_user} sounds per server`);
      }

      const data = await request.file();
      if (!data) return badRequest(reply, 'No file uploaded');

      if (!ALLOWED_AUDIO_TYPES.includes(data.mimetype)) {
        return badRequest(reply, `Audio type not allowed: ${data.mimetype}. Allowed: ${ALLOWED_AUDIO_TYPES.join(', ')}`);
      }

      const buffer = await data.toBuffer();

      if (buffer.length > config.max_sound_size_bytes) {
        return badRequest(reply, `File too large. Maximum size is ${Math.round(config.max_sound_size_bytes / 1024)}KB`);
      }

      // Get name and duration from form fields
      const fields = data.fields as any;
      const name = (fields?.name?.value || data.filename.replace(/\.[^/.]+$/, '')).slice(0, 32);
      const emoji = fields?.emoji?.value || null;
      const duration = parseFloat(fields?.duration?.value || '0');

      if (duration <= 0) {
        return badRequest(reply, 'Duration is required');
      }

      if (duration > config.max_sound_duration_seconds) {
        return badRequest(reply, `Sound too long. Maximum duration is ${config.max_sound_duration_seconds}s`);
      }

      // Upload to storage
      const ext = data.filename.split('.').pop() || 'mp3';
      const storagePath = `soundboard/${serverId}/${nanoid(12)}.${ext}`;
      const url = await storage.uploadFile(buffer, storagePath, data.mimetype);

      const sound = await db.soundboard.create({
        server_id: serverId,
        uploader_id: request.user!.id,
        name,
        emoji,
        sound_url: url,
        duration_seconds: duration,
        file_size_bytes: buffer.length,
      });

      // Notify server members
      await publishEvent({
        type: 'soundboard.added',
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: { sound },
      });

      return sound;
    },
  });

  // DELETE /servers/:serverId/soundboard/:soundId
  fastify.delete('/:serverId/soundboard/:soundId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId, soundId } = request.params as { serverId: string; soundId: string };

      const sound = await db.soundboard.findById(soundId);
      if (!sound || sound.server_id !== serverId) return notFound(reply, 'Sound');

      // Allow deletion by uploader or admins
      const isUploader = sound.uploader_id === request.user!.id;
      if (!isUploader) {
        const perms = await calculatePermissions(request.user!.id, serverId);
        if (!hasPermission(perms.server, ServerPermissions.MANAGE_SERVER)) {
          return forbidden(reply, 'Can only delete your own sounds');
        }
      }

      await db.soundboard.delete(soundId);

      await publishEvent({
        type: 'soundboard.removed',
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: { sound_id: soundId },
      });

      return { message: 'Sound deleted' };
    },
  });

  // POST /servers/:serverId/soundboard/:soundId/play
  fastify.post('/:serverId/soundboard/:soundId/play', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 30, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const { serverId, soundId } = request.params as { serverId: string; soundId: string };

      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const sound = await db.soundboard.findById(soundId);
      if (!sound || sound.server_id !== serverId) return notFound(reply, 'Sound');

      const user = await db.users.findById(request.user!.id);

      // Increment play count
      await db.soundboard.incrementPlayCount(soundId);

      // Publish play event to server
      await publishEvent({
        type: 'soundboard.play',
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: {
          server_id: serverId,
          sound_url: sound.sound_url,
          sound_name: sound.name,
          sound_id: sound.id,
          played_by: user?.display_name || user?.username || 'Unknown',
        },
      });

      return { message: 'Playing sound' };
    },
  });

  // GET /servers/:serverId/soundboard/settings
  fastify.get('/:serverId/soundboard/settings', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const server = await db.servers.findById(serverId);
      if (!server) return notFound(reply, 'Server');

      return server.soundboard_config || {
        enabled: true,
        max_sounds_per_user: 3,
        max_sound_duration_seconds: 5,
        max_sound_size_bytes: 1048576,
      };
    },
  });

  // PATCH /servers/:serverId/soundboard/settings
  fastify.patch('/:serverId/soundboard/settings', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const perms = await calculatePermissions(request.user!.id, serverId);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_SERVER)) {
        return forbidden(reply, 'Missing manage_server permission');
      }

      const updates = request.body as {
        enabled?: boolean;
        max_sounds_per_user?: number;
        max_sound_duration_seconds?: number;
        max_sound_size_bytes?: number;
      };

      const server = await db.servers.findById(serverId);
      if (!server) return notFound(reply, 'Server');

      const currentConfig = server.soundboard_config || {
        enabled: true,
        max_sounds_per_user: 3,
        max_sound_duration_seconds: 5,
        max_sound_size_bytes: 1048576,
      };

      const newConfig = {
        ...currentConfig,
        ...updates,
        // Clamp values
        max_sounds_per_user: Math.min(10, Math.max(1, updates.max_sounds_per_user ?? currentConfig.max_sounds_per_user)),
        max_sound_duration_seconds: Math.min(10, Math.max(1, updates.max_sound_duration_seconds ?? currentConfig.max_sound_duration_seconds)),
        max_sound_size_bytes: Math.min(10 * 1024 * 1024, Math.max(102400, updates.max_sound_size_bytes ?? currentConfig.max_sound_size_bytes)),
      };

      await sql`
        UPDATE servers SET soundboard_config = ${JSON.stringify(newConfig)}::jsonb WHERE id = ${serverId}
      `;

      return newConfig;
    },
  });
};
