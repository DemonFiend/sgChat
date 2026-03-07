import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db, sql } from '../lib/db.js';
import { storage } from '../lib/storage.js';
import { publishEvent } from '../lib/eventBus.js';
import { calculatePermissions } from '../services/permissions.js';
import { ServerPermissions, hasPermission } from '@sgchat/shared';
import { notFound, badRequest, forbidden } from '../utils/errors.js';
import { extractFileData } from './upload.js';
import { processEmoji } from '../lib/emojiProcessor.js';
import { nanoid } from 'nanoid';
import {
  scanDefaultPacks,
  getPackImageFiles,
  installDefaultPack,
} from '../services/defaultEmojiPacks.js';

const MAX_PACKS_PER_SERVER = 20;
const MAX_EMOJIS_PER_SERVER = 500;

export const emojiRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /servers/:serverId/emoji-packs - List packs
  fastify.get('/:serverId/emoji-packs', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };
      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      // Check if user has MANAGE_EMOJIS to show all packs including disabled
      const perms = await calculatePermissions(request.user!.id, serverId);
      const canManage = hasPermission(perms.server, ServerPermissions.MANAGE_EMOJIS);

      const packs = canManage
        ? await db.emojiPacks.findByServer(serverId)
        : await db.emojiPacks.findEnabledByServer(serverId);

      // Include master toggle state for admin UI
      const [server] = await sql`SELECT emoji_packs_enabled FROM servers WHERE id = ${serverId}`;
      return { packs, emoji_packs_enabled: server?.emoji_packs_enabled ?? true };
    },
  });

  // PATCH /servers/:serverId/emoji-packs/settings - Toggle master emoji packs setting
  fastify.patch('/:serverId/emoji-packs/settings', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };
      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const perms = await calculatePermissions(request.user!.id, serverId);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_EMOJIS)) {
        return forbidden(reply, 'Missing MANAGE_EMOJIS permission');
      }

      const body = request.body as { emoji_packs_enabled?: boolean };
      if (body?.emoji_packs_enabled === undefined || typeof body.emoji_packs_enabled !== 'boolean') {
        return badRequest(reply, 'emoji_packs_enabled (boolean) is required');
      }

      await sql`UPDATE servers SET emoji_packs_enabled = ${body.emoji_packs_enabled} WHERE id = ${serverId}`;

      await publishEvent({
        type: 'emoji.manifestUpdated',
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: { serverId },
      });

      return { emoji_packs_enabled: body.emoji_packs_enabled };
    },
  });

  // POST /servers/:serverId/emoji-packs - Create pack
  fastify.post('/:serverId/emoji-packs', {
    onRequest: [authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };
      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const perms = await calculatePermissions(request.user!.id, serverId);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_EMOJIS)) {
        return forbidden(reply, 'Missing MANAGE_EMOJIS permission');
      }

      const body = request.body as { name?: string; description?: string };
      if (!body || !body.name || typeof body.name !== 'string') {
        return badRequest(reply, 'Name is required');
      }
      const name = body.name.trim();
      if (name.length < 1 || name.length > 50) {
        return badRequest(reply, 'Name must be between 1 and 50 characters');
      }
      const description = body.description
        ? String(body.description).slice(0, 200)
        : null;

      const packCount = await db.emojiPacks.countByServer(serverId);
      if (packCount >= MAX_PACKS_PER_SERVER) {
        return badRequest(reply, `Server can have at most ${MAX_PACKS_PER_SERVER} emoji packs`);
      }

      const pack = await db.emojiPacks.create({
        server_id: serverId,
        name,
        description,
        created_by_user_id: request.user!.id,
      });

      await publishEvent({
        type: 'emoji.manifestUpdated',
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: { serverId },
      });

      return pack;
    },
  });

  // PATCH /servers/:serverId/emoji-packs/:packId - Update pack
  fastify.patch('/:serverId/emoji-packs/:packId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId, packId } = request.params as { serverId: string; packId: string };
      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const perms = await calculatePermissions(request.user!.id, serverId);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_EMOJIS)) {
        return forbidden(reply, 'Missing MANAGE_EMOJIS permission');
      }

      const pack = await db.emojiPacks.findById(packId);
      if (!pack || pack.server_id !== serverId) return notFound(reply, 'Emoji pack');

      const body = request.body as { name?: string; description?: string | null; enabled?: boolean };
      if (!body || (body.name === undefined && body.description === undefined && body.enabled === undefined)) {
        return badRequest(reply, 'At least one field to update is required');
      }

      if (body.name !== undefined) {
        if (typeof body.name !== 'string') return badRequest(reply, 'Name must be a string');
        const trimmed = body.name.trim();
        if (trimmed.length < 1 || trimmed.length > 50) {
          return badRequest(reply, 'Name must be between 1 and 50 characters');
        }
        body.name = trimmed;
      }
      if (body.description !== undefined && body.description !== null) {
        body.description = String(body.description).slice(0, 200);
      }

      const updated = await db.emojiPacks.update(packId, body);

      await publishEvent({
        type: 'emoji.manifestUpdated',
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: { serverId },
      });

      return updated;
    },
  });

  // DELETE /servers/:serverId/emoji-packs/:packId - Delete pack + cascade
  fastify.delete('/:serverId/emoji-packs/:packId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId, packId } = request.params as { serverId: string; packId: string };
      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const perms = await calculatePermissions(request.user!.id, serverId);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_EMOJIS)) {
        return forbidden(reply, 'Missing MANAGE_EMOJIS permission');
      }

      const pack = await db.emojiPacks.findById(packId);
      if (!pack || pack.server_id !== serverId) return notFound(reply, 'Emoji pack');

      // Delete emojis and get their asset keys for cleanup
      const deletedEmojis = await db.emojis.deleteByPack(packId);
      await db.emojiPacks.delete(packId);

      // Cleanup MinIO assets
      for (const emoji of deletedEmojis) {
        if (emoji.asset_key) {
          storage.deleteFile(emoji.asset_key).catch((err) =>
            console.error('Failed to delete emoji asset:', emoji.asset_key, err)
          );
        }
      }

      await publishEvent({
        type: 'emoji.manifestUpdated',
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: { serverId },
      });

      return { message: 'Emoji pack deleted' };
    },
  });

  // ============================================================
  // Emoji CRUD (within packs)
  // ============================================================

  // POST /servers/:serverId/emoji-packs/:packId/emojis - Upload emoji
  fastify.post('/:serverId/emoji-packs/:packId/emojis', {
    onRequest: [authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    bodyLimit: 4 * 1024 * 1024, // 4MB for encrypted uploads (base64 overhead)
    handler: async (request, reply) => {
      const { serverId, packId } = request.params as { serverId: string; packId: string };
      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const perms = await calculatePermissions(request.user!.id, serverId);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_EMOJIS)) {
        return forbidden(reply, 'Missing MANAGE_EMOJIS permission');
      }

      const pack = await db.emojiPacks.findById(packId);
      if (!pack || pack.server_id !== serverId) return notFound(reply, 'Emoji pack');

      const emojiCount = await db.emojis.countByServer(serverId);
      if (emojiCount >= MAX_EMOJIS_PER_SERVER) {
        return badRequest(reply, `Server can have at most ${MAX_EMOJIS_PER_SERVER} emojis`);
      }

      const fileData = await extractFileData(request);
      if (!fileData) return badRequest(reply, 'No file uploaded');

      const { buffer, filename, fields } = fileData;

      // Get shortcode from fields or filename
      let shortcode = (fields.shortcode || fields.name || filename.replace(/\.[^/.]+$/, ''))
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .slice(0, 32);
      if (shortcode.length < 2) {
        return badRequest(reply, 'Shortcode must be at least 2 characters');
      }

      // Process image
      let processed;
      try {
        processed = await processEmoji(buffer);
      } catch (err: any) {
        return badRequest(reply, err.message);
      }

      // Check shortcode uniqueness, auto-prefix on conflict
      let conflict = false;
      const existing = await db.emojis.findByShortcode(serverId, shortcode);
      if (existing) {
        conflict = true;
        shortcode = `${shortcode}_${nanoid(4)}`;
      }

      // Upload to MinIO
      const ext = processed.content_type === 'image/gif' ? 'gif' : 'webp';
      const assetKey = `emojis/${serverId}/${nanoid(12)}.${ext}`;
      await storage.uploadFile(processed.buffer, assetKey, processed.content_type);

      const emoji = await db.emojis.create({
        server_id: serverId,
        pack_id: packId,
        shortcode,
        content_type: processed.content_type,
        is_animated: processed.is_animated,
        width: processed.width,
        height: processed.height,
        size_bytes: processed.size_bytes,
        asset_key: assetKey,
        created_by_user_id: request.user!.id,
      });

      await publishEvent({
        type: 'emoji.manifestUpdated',
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: { serverId },
      });

      return { emoji, conflict: conflict ? { requested: fields.shortcode || fields.name, assigned: shortcode } : undefined };
    },
  });

  // PATCH /servers/:serverId/emojis/:emojiId - Rename shortcode
  fastify.patch('/:serverId/emojis/:emojiId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId, emojiId } = request.params as { serverId: string; emojiId: string };
      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const perms = await calculatePermissions(request.user!.id, serverId);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_EMOJIS)) {
        return forbidden(reply, 'Missing MANAGE_EMOJIS permission');
      }

      const emoji = await db.emojis.findById(emojiId);
      if (!emoji || emoji.server_id !== serverId) return notFound(reply, 'Emoji');

      const body = request.body as { shortcode?: string };
      if (!body?.shortcode || typeof body.shortcode !== 'string') {
        return badRequest(reply, 'Shortcode is required');
      }

      const shortcode = body.shortcode.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32);
      if (shortcode.length < 2) {
        return badRequest(reply, 'Shortcode must be at least 2 characters');
      }

      // Check uniqueness
      const existing = await db.emojis.findByShortcode(serverId, shortcode);
      if (existing && existing.id !== emojiId) {
        return reply.code(409).send({ error: 'Shortcode already in use' });
      }

      const updated = await db.emojis.updateShortcode(emojiId, shortcode);

      await publishEvent({
        type: 'emoji.manifestUpdated',
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: { serverId },
      });

      return updated;
    },
  });

  // DELETE /servers/:serverId/emojis/:emojiId - Delete emoji
  fastify.delete('/:serverId/emojis/:emojiId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId, emojiId } = request.params as { serverId: string; emojiId: string };
      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const perms = await calculatePermissions(request.user!.id, serverId);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_EMOJIS)) {
        return forbidden(reply, 'Missing MANAGE_EMOJIS permission');
      }

      const emoji = await db.emojis.findById(emojiId);
      if (!emoji || emoji.server_id !== serverId) return notFound(reply, 'Emoji');

      await db.emojis.delete(emojiId);

      // Cleanup MinIO asset
      if (emoji.asset_key) {
        storage.deleteFile(emoji.asset_key).catch((err) =>
          console.error('Failed to delete emoji asset:', emoji.asset_key, err)
        );
      }

      await publishEvent({
        type: 'emoji.manifestUpdated',
        actorId: request.user!.id,
        resourceId: `server:${serverId}`,
        payload: { serverId },
      });

      return { message: 'Emoji deleted' };
    },
  });

  // ============================================================
  // ZIP Importer
  // ============================================================

  // POST /servers/:serverId/emoji-packs/:packId/emojis/import-zip
  fastify.post('/:serverId/emoji-packs/:packId/emojis/import-zip', {
    onRequest: [authenticate],
    config: { rateLimit: { max: 3, timeWindow: '5 minutes' } },
    bodyLimit: 50 * 1024 * 1024, // 50MB for ZIP uploads
    handler: async (request, reply) => {
      const { serverId, packId } = request.params as { serverId: string; packId: string };
      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const perms = await calculatePermissions(request.user!.id, serverId);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_EMOJIS)) {
        return forbidden(reply, 'Missing MANAGE_EMOJIS permission');
      }

      const pack = await db.emojiPacks.findById(packId);
      if (!pack || pack.server_id !== serverId) return notFound(reply, 'Emoji pack');

      const fileData = await extractFileData(request);
      if (!fileData) return badRequest(reply, 'No file uploaded');

      let AdmZip;
      try {
        AdmZip = (await import('adm-zip')).default;
      } catch {
        return reply.code(500).send({ error: 'ZIP processing not available' });
      }

      let zip;
      try {
        zip = new AdmZip(fileData.buffer);
      } catch {
        return badRequest(reply, 'Invalid ZIP file');
      }

      const entries = zip.getEntries();
      const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
      const validEntries = entries.filter(e => {
        if (e.isDirectory) return false;
        const name = e.entryName.toLowerCase();
        // Reject directory traversal
        if (name.includes('..') || name.startsWith('/')) return false;
        return imageExtensions.some(ext => name.endsWith(ext));
      });

      if (validEntries.length === 0) {
        return badRequest(reply, 'No valid image files found in ZIP');
      }
      if (validEntries.length > 500) {
        return badRequest(reply, 'ZIP contains too many files (max 500)');
      }

      // Check server emoji limit
      const currentCount = await db.emojis.countByServer(serverId);
      const available = MAX_EMOJIS_PER_SERVER - currentCount;
      if (available <= 0) {
        return badRequest(reply, 'Server emoji limit reached');
      }

      const results: { importedCount: number; conflicts: { requested: string; assigned: string }[]; errors: { filename: string; error: string }[] } = {
        importedCount: 0,
        conflicts: [],
        errors: [],
      };

      const toProcess = validEntries.slice(0, available);
      const usedInBatch = new Set<string>();
      const packNamePrefix = pack.name.replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase();

      for (const entry of toProcess) {
        const filename = entry.entryName.split('/').pop() || entry.entryName;
        try {
          const buffer = entry.getData();

          // Check uncompressed size
          if (buffer.length > 200 * 1024 * 1024) {
            results.errors.push({ filename, error: 'File too large' });
            continue;
          }

          const processed = await processEmoji(buffer);

          // Derive shortcode: strip numeric prefix, normalize
          let shortcode = filename.replace(/\.[^/.]+$/, '');
          shortcode = shortcode.replace(/^\d+[-_]/, ''); // strip leading "839220-"
          shortcode = shortcode.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32);

          // Short names get pack prefix (non-default packs)
          if (shortcode.length < 2) {
            shortcode = `${packNamePrefix}_${shortcode}`;
            if (shortcode.length < 2) shortcode = `emoji_${nanoid(4)}`;
          }

          // Check uniqueness with sequential suffix
          if (usedInBatch.has(shortcode) || await db.emojis.findByShortcode(serverId, shortcode)) {
            const original = shortcode;
            for (let i = 1; i < 100; i++) {
              const candidate = `${shortcode}_${String(i).padStart(2, '0')}`;
              if (!usedInBatch.has(candidate) && !await db.emojis.findByShortcode(serverId, candidate)) {
                shortcode = candidate;
                break;
              }
            }
            if (shortcode === original) shortcode = `${shortcode}_${nanoid(4)}`;
            results.conflicts.push({ requested: original, assigned: shortcode });
          }
          usedInBatch.add(shortcode);

          const ext = processed.content_type === 'image/gif' ? 'gif' : 'webp';
          const assetKey = `emojis/${serverId}/${nanoid(12)}.${ext}`;
          await storage.uploadFile(processed.buffer, assetKey, processed.content_type);

          await db.emojis.create({
            server_id: serverId,
            pack_id: packId,
            shortcode,
            content_type: processed.content_type,
            is_animated: processed.is_animated,
            width: processed.width,
            height: processed.height,
            size_bytes: processed.size_bytes,
            asset_key: assetKey,
            created_by_user_id: request.user!.id,
          });

          results.importedCount++;
        } catch (err: any) {
          results.errors.push({ filename, error: err.message });
        }
      }

      if (results.importedCount > 0) {
        await publishEvent({
          type: 'emoji.manifestUpdated',
          actorId: request.user!.id,
          resourceId: `server:${serverId}`,
          payload: { serverId },
        });
      }

      return results;
    },
  });

  // ============================================================
  // emoji.gg Importer (owner-only)
  // ============================================================

  // POST /servers/:serverId/emoji-packs/:packId/emojis/import-emoji-gg
  fastify.post('/:serverId/emoji-packs/:packId/emojis/import-emoji-gg', {
    onRequest: [authenticate],
    config: { rateLimit: { max: 2, timeWindow: '5 minutes' } },
    handler: async (request, reply) => {
      const { serverId, packId } = request.params as { serverId: string; packId: string };

      // Owner-only check
      const [server] = await db.sql`SELECT owner_id FROM servers WHERE id = ${serverId}`;
      if (!server || server.owner_id !== request.user!.id) {
        return forbidden(reply, 'Only the server owner can use emoji.gg import');
      }

      const pack = await db.emojiPacks.findById(packId);
      if (!pack || pack.server_id !== serverId) return notFound(reply, 'Emoji pack');

      const enabled = process.env.EMOJI_IMPORT_EMOJIGG_ENABLED !== 'false';
      if (!enabled) {
        return badRequest(reply, 'emoji.gg import is disabled');
      }

      const body = request.body as { packUrl?: string; packId?: string; emojis?: { name: string; url: string }[] };

      // Accept either a pre-fetched emoji list or a pack URL/ID
      let emojiList: { name: string; url: string }[] = [];

      if (body.emojis && Array.isArray(body.emojis)) {
        emojiList = body.emojis.slice(0, 100);
      } else {
        return badRequest(reply, 'Provide an emojis array with {name, url} objects');
      }

      if (emojiList.length === 0) {
        return badRequest(reply, 'No emojis to import');
      }

      // Check server emoji limit
      const currentCount = await db.emojis.countByServer(serverId);
      const available = MAX_EMOJIS_PER_SERVER - currentCount;
      if (available <= 0) {
        return badRequest(reply, 'Server emoji limit reached');
      }

      const allowedHosts = (process.env.EMOJI_IMPORT_EMOJIGG_ALLOWED_HOSTS || 'emoji.gg,cdn.emoji.gg').split(',');

      const results = { importedCount: 0, conflicts: [] as { requested: string; assigned: string }[], errors: [] as { name: string; error: string }[] };

      const toProcess = emojiList.slice(0, available);

      for (const item of toProcess) {
        try {
          // SSRF protection: validate URL host
          const url = new URL(item.url);
          if (!allowedHosts.includes(url.hostname)) {
            results.errors.push({ name: item.name, error: 'Host not allowed' });
            continue;
          }
          // Block private IPs
          if (/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|0\.)/.test(url.hostname) || url.hostname === '::1' || url.hostname === 'localhost') {
            results.errors.push({ name: item.name, error: 'Private IP blocked' });
            continue;
          }

          // Fetch with timeout
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          const response = await fetch(item.url, {
            signal: controller.signal,
            redirect: 'error', // Don't follow redirects
          });
          clearTimeout(timeout);

          if (!response.ok) {
            results.errors.push({ name: item.name, error: `HTTP ${response.status}` });
            continue;
          }

          const arrayBuffer = await response.arrayBuffer();
          if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
            results.errors.push({ name: item.name, error: 'File too large (max 5MB)' });
            continue;
          }

          const buffer = Buffer.from(arrayBuffer);
          const processed = await processEmoji(buffer);

          let shortcode = item.name.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32);
          if (shortcode.length < 2) shortcode = `emoji_${nanoid(4)}`;

          const existing = await db.emojis.findByShortcode(serverId, shortcode);
          if (existing) {
            const original = shortcode;
            shortcode = `${shortcode}_${nanoid(4)}`;
            results.conflicts.push({ requested: original, assigned: shortcode });
          }

          const ext = processed.content_type === 'image/gif' ? 'gif' : 'webp';
          const assetKey = `emojis/${serverId}/${nanoid(12)}.${ext}`;
          await storage.uploadFile(processed.buffer, assetKey, processed.content_type);

          await db.emojis.create({
            server_id: serverId,
            pack_id: packId,
            shortcode,
            content_type: processed.content_type,
            is_animated: processed.is_animated,
            width: processed.width,
            height: processed.height,
            size_bytes: processed.size_bytes,
            asset_key: assetKey,
            created_by_user_id: request.user!.id,
          });

          results.importedCount++;
        } catch (err: any) {
          results.errors.push({ name: item.name, error: err.message });
        }
      }

      if (results.importedCount > 0) {
        await publishEvent({
          type: 'emoji.manifestUpdated',
          actorId: request.user!.id,
          resourceId: `server:${serverId}`,
          payload: { serverId },
        });
      }

      return results;
    },
  });

  // ============================================================
  // Default Emoji Packs
  // ============================================================

  // GET /servers/:serverId/emoji-packs/defaults - Browse default pack catalog
  fastify.get('/:serverId/emoji-packs/defaults', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      try {
        const { serverId } = request.params as { serverId: string };
        const member = await db.members.findByUserAndServer(request.user!.id, serverId);
        if (!member) return forbidden(reply, 'Not a server member');

        const categories = scanDefaultPacks().map((cat) => ({
          ...cat,
          packs: cat.packs.map((p) => ({ ...p })),
        }));

        // Mark which packs are already installed
        try {
          const installed = await db.emojiPacks.findDefaultsByServer(serverId);
          const installedMap = new Map(installed.map((p: any) => [p.default_pack_key, p.id]));

          for (const cat of categories) {
            for (const pack of cat.packs) {
              const packId = installedMap.get(pack.key);
              if (packId) {
                pack.installed = true;
                pack.installedPackId = packId;
              }
            }
          }
        } catch (err) {
          // source column may not exist yet if migration hasn't been applied
          console.error('[DefaultEmojiPacks] Error checking installed packs:', err);
        }

        return { categories };
      } catch (err) {
        console.error('[DefaultEmojiPacks] Unhandled error in defaults route:', err);
        return reply.code(500).send({ error: 'Internal server error', details: String(err) });
      }
    },
  });

  // POST /servers/:serverId/emoji-packs/install-default - Install a default pack
  fastify.post('/:serverId/emoji-packs/install-default', {
    onRequest: [authenticate],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };
      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      const perms = await calculatePermissions(request.user!.id, serverId);
      if (!hasPermission(perms.server, ServerPermissions.MANAGE_EMOJIS)) {
        return forbidden(reply, 'Missing MANAGE_EMOJIS permission');
      }

      const body = request.body as { key?: string };
      if (!body?.key || typeof body.key !== 'string') {
        return badRequest(reply, 'Pack key is required');
      }

      const key = body.key;
      if (key.includes('..') || key.startsWith('/') || key.split('/').length !== 2) {
        return badRequest(reply, 'Invalid pack key');
      }

      const imageFiles = getPackImageFiles(key);
      if (imageFiles.length === 0) {
        return notFound(reply, 'Default emoji pack');
      }

      const existing = await db.emojiPacks.findByDefaultKey(serverId, key);
      if (existing) {
        return reply.code(409).send({ error: 'Pack already installed', packId: existing.id });
      }

      const packCount = await db.emojiPacks.countByServer(serverId);
      if (packCount >= MAX_PACKS_PER_SERVER) {
        return badRequest(reply, `Server can have at most ${MAX_PACKS_PER_SERVER} emoji packs`);
      }

      const currentEmojiCount = await db.emojis.countByServer(serverId);
      if (currentEmojiCount >= MAX_EMOJIS_PER_SERVER) {
        return badRequest(reply, 'Server emoji limit reached');
      }

      const result = await installDefaultPack(serverId, key, request.user!.id);
      if (!result) {
        return reply.code(409).send({ error: 'Pack already installed or not found' });
      }

      if (result.importedCount > 0) {
        await publishEvent({
          type: 'emoji.manifestUpdated',
          actorId: request.user!.id,
          resourceId: `server:${serverId}`,
          payload: { serverId },
        });
      }

      return result;
    },
  });

  // ============================================================
  // Emoji Manifest
  // ============================================================

  // GET /servers/:serverId/emojis/manifest - Get emoji manifest
  fastify.get('/:serverId/emojis/manifest', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };
      const member = await db.members.findByUserAndServer(request.user!.id, serverId);
      if (!member) return forbidden(reply, 'Not a server member');

      // Check master toggle
      const [server] = await sql`SELECT emoji_packs_enabled FROM servers WHERE id = ${serverId}`;
      const enabled = server?.emoji_packs_enabled ?? true;

      const packs = enabled ? await db.emojiPacks.findEnabledByServer(serverId) : [];
      const emojis = enabled ? await db.emojis.findEnabledByServer(serverId) : [];

      // Build version hash from pack/emoji count + latest updated_at
      const latestUpdate = [...packs, ...emojis]
        .map((item: any) => new Date(item.updated_at || item.created_at).getTime())
        .reduce((max, t) => Math.max(max, t), 0);
      const version = latestUpdate || 0;

      // ETag support (include toggle state so toggling invalidates cache)
      const etag = `"emoji-${serverId}-${version}-${enabled}"`;
      const ifNoneMatch = request.headers['if-none-match'];
      if (ifNoneMatch === etag) {
        return reply.code(304).send();
      }

      reply.header('ETag', etag);
      reply.header('Cache-Control', 'private, must-revalidate');

      // Compute public URLs for emoji assets
      const emojisWithUrls = emojis.map((e: any) => ({
        ...e,
        url: e.asset_key ? storage.getPublicUrl(e.asset_key) : undefined,
      }));

      return {
        version,
        packs,
        emojis: emojisWithUrls,
      };
    },
  });
};
