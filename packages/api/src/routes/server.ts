/**
 * Global Server Endpoint - Single-Tenant Model
 * 
 * In sgChat's single-tenant architecture, each deployment IS a server.
 * This endpoint provides info about the instance itself.
 */
import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { ServerPermissions, hasPermission, DEFAULT_AVATAR_LIMITS } from '@sgchat/shared';
import type { AvatarLimits } from '@sgchat/shared';
import { calculatePermissions } from '../services/permissions.js';
import { forbidden, notFound, badRequest } from '../utils/errors.js';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { emitEncrypted } from '../lib/socketEmit.js';
import { extractFileData } from './upload.js';
import { validateImage, processBannerImage } from '../lib/imageProcessor.js';
import { storage } from '../lib/storage.js';
import { getServerStorageStats } from '../services/segmentation.js';
import { 
  getServerRetentionSettings, 
  updateServerRetentionSettings,
  runCleanupJob,
  checkStorageThresholds,
  getTrimmingLogs,
} from '../services/trimming.js';
import { checkArchiveHealth } from '../services/archive.js';
import {
  getFullStorageDashboard,
  getStorageLimits,
  updateStorageLimits,
  purgeByCategory,
  runAutoPurge,
  type PurgeCategory,
} from '../services/storageAggregation.js';

const updateServerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  icon_url: z.string().url().nullable().optional(),
  banner_url: z.string().url().nullable().optional(),
  motd: z.string().max(2000).nullable().optional(),
  motd_enabled: z.boolean().optional(),
  timezone: z.string().max(50).optional(),
  afk_timeout: z.number().int().min(60).max(3600).optional(), // 1 min to 1 hour
  afk_channel_id: z.string().uuid().nullable().optional(),
  temp_channel_timeout: z.number().int().min(30).max(86400).optional(), // 30s to 24h
  welcome_channel_id: z.string().uuid().nullable().optional(),
  announce_joins: z.boolean().optional(),
  announce_leaves: z.boolean().optional(),
  announce_online: z.boolean().optional(),
});

const transferOwnershipSchema = z.object({
  user_id: z.string().uuid(),
});

/**
 * Get the default/primary server for single-tenant mode
 * Returns the first server created (by created_at)
 */
async function getDefaultServer() {
  const [server] = await db.sql`
    SELECT * FROM servers 
    ORDER BY created_at ASC 
    LIMIT 1
  `;
  return server;
}

export const globalServerRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /server - Get instance/server info
   * Public info about this sgChat deployment
   */
  fastify.get('/', {
    onRequest: [authenticate],
    handler: async (request, _reply) => {
      const server = await getDefaultServer();

      if (!server) {
        // No server exists yet - return basic instance info
        return {
          id: null,
          name: process.env.SERVER_NAME || 'sgChat Server',
          description: null,
          icon_url: null,
          banner_url: null,
          owner_id: null,
          created_at: null,
          member_count: 0,
          admin_claimed: false,
          features: ['voice', 'video', 'file_uploads'],
        };
      }

      // Get member count
      const [{ count }] = await db.sql`
        SELECT COUNT(*) as count FROM members WHERE server_id = ${server.id}
      `;

      // Check if user has admin permission to see full settings
      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) || 
                      server.owner_id === request.user!.id;

      // Base response for all users
      const response: any = {
        id: server.id,
        name: server.name,
        description: server.description || null,
        icon_url: server.icon_url,
        banner_url: server.banner_url || null,
        owner_id: server.owner_id,
        created_at: server.created_at,
        member_count: parseInt(count, 10),
        admin_claimed: server.admin_claimed,
        features: ['voice', 'video', 'file_uploads'],
        // Server time info for client sync
        server_time: new Date().toISOString(),
        timezone: server.timezone || 'UTC',
      };

      // Include MOTD if enabled
      if (server.motd_enabled && server.motd) {
        response.motd = server.motd;
      }

      // Include full settings only for admins
      if (isAdmin) {
        response.settings = {
          motd: server.motd,
          motd_enabled: server.motd_enabled,
          timezone: server.timezone,
          announce_joins: server.announce_joins,
          announce_leaves: server.announce_leaves,
          announce_online: server.announce_online,
          afk_timeout: server.afk_timeout,
          temp_channel_timeout: server.temp_channel_timeout,
          welcome_channel_id: server.welcome_channel_id,
          afk_channel_id: server.afk_channel_id,
        };
      }

      return response;
    },
  });

  /**
   * GET /server/time - Get current server time and timezone
   * Useful for client-side time synchronization
   */
  fastify.get('/time', {
    onRequest: [authenticate],
    handler: async (_request, _reply) => {
      const server = await getDefaultServer();
      const timezone = server?.timezone || 'UTC';
      const now = new Date();
      
      // Calculate timezone offset (simplified - uses server's JS runtime timezone)
      const offsetMinutes = now.getTimezoneOffset();
      const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
      const offsetMins = Math.abs(offsetMinutes) % 60;
      const offsetSign = offsetMinutes <= 0 ? '+' : '-';
      const timezoneOffset = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;

      return {
        server_time: now.toISOString(),
        timezone: timezone,
        timezone_offset: timezoneOffset,
        unix_timestamp: Math.floor(now.getTime() / 1000),
      };
    },
  });

  /**
   * PATCH /server - Update instance/server settings
   * Requires ADMINISTRATOR permission or be server owner
   */
  fastify.patch('/', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      // Check if user is admin or owner
      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) || 
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can modify server settings');
      }

      const body = updateServerSchema.parse(request.body);
      
      const updates: Record<string, any> = {};
      if (body.name !== undefined) updates.name = body.name;
      if ('description' in body) updates.description = body.description;
      if ('icon_url' in body) updates.icon_url = body.icon_url;
      if ('banner_url' in body) updates.banner_url = body.banner_url;
      if ('motd' in body) updates.motd = body.motd;
      if (body.motd_enabled !== undefined) updates.motd_enabled = body.motd_enabled;
      if (body.timezone !== undefined) updates.timezone = body.timezone;
      if (body.afk_timeout !== undefined) updates.afk_timeout = body.afk_timeout;
      if ('afk_channel_id' in body) updates.afk_channel_id = body.afk_channel_id;
      if (body.temp_channel_timeout !== undefined) updates.temp_channel_timeout = body.temp_channel_timeout;
      if ('welcome_channel_id' in body) updates.welcome_channel_id = body.welcome_channel_id;
      if (body.announce_joins !== undefined) updates.announce_joins = body.announce_joins;
      if (body.announce_leaves !== undefined) updates.announce_leaves = body.announce_leaves;
      if (body.announce_online !== undefined) updates.announce_online = body.announce_online;

      if (Object.keys(updates).length === 0) {
        return badRequest(reply, 'No updates provided');
      }

      // Validate channel references if provided
      if (updates.afk_channel_id) {
        const [channel] = await db.sql`
          SELECT id, type FROM channels WHERE id = ${updates.afk_channel_id} AND server_id = ${server.id}
        `;
        if (!channel) {
          return badRequest(reply, 'AFK channel not found');
        }
        if (channel.type !== 'voice') {
          return badRequest(reply, 'AFK channel must be a voice channel');
        }
      }

      if (updates.welcome_channel_id) {
        const [channel] = await db.sql`
          SELECT id, type FROM channels WHERE id = ${updates.welcome_channel_id} AND server_id = ${server.id}
        `;
        if (!channel) {
          return badRequest(reply, 'Welcome channel not found');
        }
        if (channel.type !== 'text') {
          return badRequest(reply, 'Welcome channel must be a text channel');
        }
      }

      await db.sql`
        UPDATE servers
        SET ${db.sql(updates)}
        WHERE id = ${server.id}
      `;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${server.id}, ${request.user!.id}, 'server_update', 'server', ${server.id}, ${JSON.stringify(updates)})
      `;

      // Broadcast update
      const updated = await getDefaultServer();
      await emitEncrypted(fastify.io, `server:${server.id}`,'server.update', updated);

      return updated;
    },
  });

  /**
   * POST /server/banner - Upload server banner image
   * Requires ADMINISTRATOR permission or be server owner
   */
  fastify.post('/banner', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 10, timeWindow: '1 hour' },
    },
    bodyLimit: 12 * 1024 * 1024,
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return notFound(reply, 'Server');

      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                      server.owner_id === request.user!.id;
      if (!isAdmin) return forbidden(reply, 'Only administrators can modify server settings');

      const fileData = await extractFileData(request);
      if (!fileData) return badRequest(reply, 'No file uploaded');

      const { buffer } = fileData;
      const maxSize = 8 * 1024 * 1024;
      if (buffer.length > maxSize) return badRequest(reply, 'File too large. Maximum size is 8MB');

      try {
        await validateImage(buffer);
      } catch (error) {
        return badRequest(reply, error instanceof Error ? error.message : 'Invalid image');
      }

      // Delete old banner if exists
      if (server.banner_url) {
        try {
          const url = new URL(server.banner_url);
          const objectPath = url.pathname.split('/').slice(2).join('/');
          await storage.deleteFile(objectPath);
        } catch {
          // Old banner cleanup is best-effort
        }
      }

      const processed = await processBannerImage(buffer, 1920, 480, 80);
      const storagePath = `banners/server-${server.id}-${nanoid(8)}.webp`;
      const bannerUrl = await storage.uploadFile(processed.buffer, storagePath, 'image/webp');

      await db.sql`
        UPDATE servers SET banner_url = ${bannerUrl} WHERE id = ${server.id}
      `;

      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${server.id}, ${request.user!.id}, 'server_update', 'server', ${server.id}, ${JSON.stringify({ banner_url: bannerUrl })})
      `;

      const updated = await getDefaultServer();
      await emitEncrypted(fastify.io, `server:${server.id}`, 'server.update', updated);

      return { banner_url: bannerUrl };
    },
  });

  /**
   * DELETE /server/banner - Remove server banner image
   * Requires ADMINISTRATOR permission or be server owner
   */
  fastify.delete('/banner', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) return notFound(reply, 'Server');

      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                      server.owner_id === request.user!.id;
      if (!isAdmin) return forbidden(reply, 'Only administrators can modify server settings');

      if (!server.banner_url) return badRequest(reply, 'No banner to delete');

      try {
        const url = new URL(server.banner_url);
        const objectPath = url.pathname.split('/').slice(2).join('/');
        await storage.deleteFile(objectPath);
      } catch {
        // Cleanup is best-effort
      }

      await db.sql`
        UPDATE servers SET banner_url = NULL WHERE id = ${server.id}
      `;

      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${server.id}, ${request.user!.id}, 'server_update', 'server', ${server.id}, ${JSON.stringify({ banner_url: null })})
      `;

      const updated = await getDefaultServer();
      await emitEncrypted(fastify.io, `server:${server.id}`, 'server.update', updated);

      return { message: 'Banner removed' };
    },
  });

  /**
   * POST /server/transfer-ownership - Transfer server ownership to another user
   * Only the current owner can transfer ownership
   */
  fastify.post('/transfer-ownership', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      // Only current owner can transfer
      if (server.owner_id !== request.user!.id) {
        return forbidden(reply, 'Only the server owner can transfer ownership');
      }

      const { user_id: newOwnerId } = transferOwnershipSchema.parse(request.body);

      // Can't transfer to yourself
      if (newOwnerId === request.user!.id) {
        return badRequest(reply, 'Cannot transfer ownership to yourself');
      }

      // Check if target user is a member
      const [targetMember] = await db.sql`
        SELECT user_id FROM members WHERE user_id = ${newOwnerId} AND server_id = ${server.id}
      `;

      if (!targetMember) {
        return badRequest(reply, 'Target user must be a member of the server');
      }

      // Transfer ownership
      await db.sql`
        UPDATE servers
        SET owner_id = ${newOwnerId}
        WHERE id = ${server.id}
      `;

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (
          ${server.id}, 
          ${request.user!.id}, 
          'ownership_transferred', 
          'server', 
          ${server.id}, 
          ${JSON.stringify({ from: request.user!.id, to: newOwnerId })}
        )
      `;

      // Get target user info
      const [newOwner] = await db.sql`
        SELECT id, username FROM users WHERE id = ${newOwnerId}
      `;

      console.log(`🔄 Server ownership transferred from ${request.user!.id} to ${newOwnerId}`);

      // Broadcast update
      await emitEncrypted(fastify.io, `server:${server.id}`,'server.ownership_transferred', {
        previous_owner_id: request.user!.id,
        new_owner_id: newOwnerId,
      });

      return {
        message: 'Ownership transferred successfully',
        new_owner: {
          id: newOwner.id,
          username: newOwner.username,
        },
      };
    },
  });

  // ============================================================
  // ADMIN SETTINGS - Avatar Limits
  // ============================================================

  const avatarLimitsSchema = z.object({
    max_upload_size_bytes: z.number().min(1024).max(50 * 1024 * 1024).optional(), // 1KB - 50MB
    max_dimension: z.number().min(32).max(2048).optional(),
    default_dimension: z.number().min(32).max(1024).optional(),
    output_quality: z.number().min(1).max(100).optional(),
    max_storage_per_user_bytes: z.number().min(1024).max(100 * 1024 * 1024).optional(), // 1KB - 100MB
  });

  /**
   * GET /server/settings/avatar-limits - Get current avatar limits
   * Requires ADMINISTRATOR permission or be server owner
   */
  fastify.get('/settings/avatar-limits', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      // Check if user is admin or owner
      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) || 
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can view avatar limit settings');
      }

      // Get current settings or return defaults
      const setting = await db.instanceSettings.get('avatar_limits');
      if (setting?.value) {
        return setting.value;
      }

      // Return defaults
      return {
        max_upload_size_bytes: DEFAULT_AVATAR_LIMITS.MAX_UPLOAD_SIZE,
        max_dimension: DEFAULT_AVATAR_LIMITS.MAX_DIMENSION,
        default_dimension: DEFAULT_AVATAR_LIMITS.DEFAULT_DIMENSION,
        output_quality: DEFAULT_AVATAR_LIMITS.OUTPUT_QUALITY,
        max_storage_per_user_bytes: DEFAULT_AVATAR_LIMITS.MAX_STORAGE_PER_USER,
      };
    },
  });

  /**
   * PATCH /server/settings/avatar-limits - Update avatar limits
   * Requires ADMINISTRATOR permission or be server owner
   */
  fastify.patch('/settings/avatar-limits', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      // Check if user is admin or owner
      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) || 
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can modify avatar limit settings');
      }

      const updates = avatarLimitsSchema.parse(request.body);

      // Get current settings
      const setting = await db.instanceSettings.get('avatar_limits');
      const currentLimits: AvatarLimits = setting?.value || {
        max_upload_size_bytes: DEFAULT_AVATAR_LIMITS.MAX_UPLOAD_SIZE,
        max_dimension: DEFAULT_AVATAR_LIMITS.MAX_DIMENSION,
        default_dimension: DEFAULT_AVATAR_LIMITS.DEFAULT_DIMENSION,
        output_quality: DEFAULT_AVATAR_LIMITS.OUTPUT_QUALITY,
        max_storage_per_user_bytes: DEFAULT_AVATAR_LIMITS.MAX_STORAGE_PER_USER,
      };

      // Merge updates
      const newLimits: AvatarLimits = {
        ...currentLimits,
        ...updates,
      };

      // Validate that default_dimension doesn't exceed max_dimension
      if (newLimits.default_dimension > newLimits.max_dimension) {
        return badRequest(reply, 'default_dimension cannot exceed max_dimension');
      }

      // Save updated settings
      await db.instanceSettings.set('avatar_limits', newLimits);

      console.log(`🖼️ Avatar limits updated by ${request.user!.id}:`, newLimits);

      return {
        message: 'Avatar limits updated',
        limits: newLimits,
      };
    },
  });

  // ============================================================
  // RETENTION & STORAGE SETTINGS
  // ============================================================

  const retentionSettingsSchema = z.object({
    default_channel_retention_days: z.number().min(1).max(730).optional(),
    default_dm_retention_days: z.number().min(1).max(730).optional(),
    default_channel_size_limit_bytes: z.number().min(0).optional(),
    storage_warning_threshold_percent: z.number().min(0).max(100).optional(),
    storage_action_threshold_percent: z.number().min(0).max(100).optional(),
    cleanup_schedule: z.enum(['daily', 'weekly', 'monthly']).optional(),
    segment_duration_hours: z.number().min(1).max(168).optional(), // 1 hour to 1 week
    min_retention_hours: z.number().min(1).max(168).optional(),
    archive_enabled: z.boolean().optional(),
  });

  /**
   * GET /server/storage - Get server-wide storage statistics
   */
  fastify.get('/storage', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) || 
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can view storage statistics');
      }

      const stats = await getServerStorageStats(server.id);
      const retentionSettings = await getServerRetentionSettings();
      const archiveHealth = await checkArchiveHealth();
      const thresholdAlerts = await checkStorageThresholds();

      return {
        stats,
        archive: archiveHealth,
        alerts: thresholdAlerts,
        settings: {
          default_size_limit_bytes: retentionSettings.default_channel_size_limit_bytes,
          warning_threshold_percent: retentionSettings.storage_warning_threshold_percent,
          action_threshold_percent: retentionSettings.storage_action_threshold_percent,
        },
      };
    },
  });

  /**
   * GET /server/settings/retention - Get default retention settings
   */
  fastify.get('/settings/retention', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) || 
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can view retention settings');
      }

      const settings = await getServerRetentionSettings();
      return settings;
    },
  });

  /**
   * PATCH /server/settings/retention - Update default retention settings
   */
  fastify.patch('/settings/retention', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) || 
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can modify retention settings');
      }

      const updates = retentionSettingsSchema.parse(request.body);
      const newSettings = await updateServerRetentionSettings(updates);

      // Audit log
      await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${server.id}, ${request.user!.id}, 'server_update', 'server', ${server.id}, 
          ${JSON.stringify({ retention_settings: updates })})
      `;

      console.log(`📦 Retention settings updated by ${request.user!.id}:`, updates);

      return {
        message: 'Retention settings updated',
        settings: newSettings,
      };
    },
  });

  /**
   * POST /server/cleanup/run - Manually trigger server-wide cleanup
   */
  fastify.post<{ Body: { dry_run?: boolean } }>('/cleanup/run', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) || 
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can trigger cleanup');
      }

      const { dry_run = false } = request.body || {};
      
      const result = await runCleanupJob({ dryRun: dry_run });

      // Audit log (only for actual cleanup)
      if (!dry_run && result.totalMessagesDeleted > 0) {
        await db.sql`
          INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
          VALUES (${server.id}, ${request.user!.id}, 'server_update', 'server', ${server.id}, 
            ${JSON.stringify({ 
              manual_cleanup: {
                messages_deleted: result.totalMessagesDeleted,
                bytes_freed: result.totalBytesFreed,
                channels_affected: result.summaries.length,
              }
            })})
        `;
      }

      console.log(`🧹 Manual cleanup ${dry_run ? '(dry run)' : ''} triggered by ${request.user!.id}:`, {
        messages: result.totalMessagesDeleted,
        bytes: result.totalBytesFreed,
      });

      return {
        dry_run,
        total_messages_deleted: result.totalMessagesDeleted,
        total_bytes_freed: result.totalBytesFreed,
        summaries: result.summaries,
      };
    },
  });

  /**
   * GET /server/cleanup/logs - Get trimming/cleanup audit logs
   */
  fastify.get<{ Querystring: { limit?: string; offset?: string } }>('/cleanup/logs', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) || 
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can view cleanup logs');
      }

      const { limit, offset } = request.query;
      const logs = await getTrimmingLogs({
        limit: parseInt(limit || '50'),
        offset: parseInt(offset || '0'),
      });

      return { logs };
    },
  });

  /**
   * GET /server/storage/thresholds - Check which channels are approaching limits
   */
  fastify.get('/storage/thresholds', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (!server) {
        return notFound(reply, 'Server');
      }

      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) || 
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can view storage thresholds');
      }

      const alerts = await checkStorageThresholds();
      const settings = await getServerRetentionSettings();

      return {
        warning_threshold_percent: settings.storage_warning_threshold_percent,
        action_threshold_percent: settings.storage_action_threshold_percent,
        alerts,
      };
    },
  });

  /**
   * POST /server/storage/alerts/check - Run storage alert check and notify admins
   */
  fastify.post('/storage/alerts/check', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can trigger alert checks');
      }

      const { generateStorageAlerts, notifyAdminsOfStorageAlerts } = await import('../services/trimming.js');
      
      const { warning, critical } = await generateStorageAlerts();
      const allAlerts = [...warning, ...critical];

      const serverAlerts = allAlerts.filter(a => a.server_id === server.id);
      let notificationResult = { notified: 0, adminIds: [] as string[] };

      if (serverAlerts.length > 0) {
        notificationResult = await notifyAdminsOfStorageAlerts(server.id, serverAlerts);
      }

      return {
        warning_count: warning.length,
        critical_count: critical.length,
        server_alerts: serverAlerts.length,
        admins_notified: notificationResult.notified,
        alerts: serverAlerts,
      };
    },
  });

  /**
   * GET /server/storage/alerts - Get current storage alerts (without notifying)
   */
  fastify.get('/storage/alerts', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can view storage alerts');
      }

      const { generateStorageAlerts } = await import('../services/trimming.js');
      const { warning, critical } = await generateStorageAlerts();

      const serverAlerts = {
        warning: warning.filter(a => a.server_id === server.id),
        critical: critical.filter(a => a.server_id === server.id),
      };

      return {
        ...serverAlerts,
        total_warning: serverAlerts.warning.length,
        total_critical: serverAlerts.critical.length,
      };
    },
  });

  /**
   * GET /server/storage/comprehensive - Get comprehensive server storage stats
   */
  fastify.get('/storage/comprehensive', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can view storage statistics');
      }

      // Get text-bearing channels only (voice/stage/AFK don't store messages)
      const channels = await db.sql`
        SELECT id, name FROM channels
        WHERE server_id = ${server.id} AND type IN ('text', 'announcement')
      `;

      const { getComprehensiveStorageStats } = await import('../services/trimming.js');
      
      const channelStats = await Promise.all(
        channels.map(async (ch: any) => ({
          channel_id: ch.id,
          channel_name: ch.name,
          stats: await getComprehensiveStorageStats(ch.id, null),
        }))
      );

      const totals = {
        message_storage_bytes: 0,
        media_storage_bytes: 0,
        total_bytes: 0,
        channel_count: channels.length,
      };

      for (const cs of channelStats) {
        totals.message_storage_bytes += cs.stats.message_storage.total_size_bytes;
        totals.media_storage_bytes += cs.stats.media_storage.total_size_bytes;
        totals.total_bytes += cs.stats.total_size_bytes;
      }

      return {
        server_id: server.id,
        totals,
        channels: channelStats,
      };
    },
  });

  // ============================================================
  // STORAGE DASHBOARD ROUTES
  // ============================================================

  /**
   * GET /server/storage/dashboard - Full storage dashboard with all categories
   */
  fastify.get('/storage/dashboard', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 12, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can view storage dashboard');
      }

      return getFullStorageDashboard(server.id);
    },
  });

  /**
   * GET /server/storage/limits - Get current storage limits
   */
  fastify.get('/storage/limits', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can view storage limits');
      }

      return getStorageLimits();
    },
  });

  const storageLimitsUpdateSchema = z.object({
    channel_message_limit_bytes: z.number().min(0).nullable().optional(),
    channel_attachment_limit_bytes: z.number().min(0).nullable().optional(),
    dm_message_limit_bytes: z.number().min(0).nullable().optional(),
    dm_attachment_limit_bytes: z.number().min(0).nullable().optional(),
    emoji_storage_limit_bytes: z.number().min(0).nullable().optional(),
    sticker_storage_limit_bytes: z.number().min(0).nullable().optional(),
    profile_avatar_limit_bytes: z.number().min(0).nullable().optional(),
    profile_banner_limit_bytes: z.number().min(0).nullable().optional(),
    profile_sound_limit_bytes: z.number().min(0).nullable().optional(),
    upload_limit_per_user_bytes: z.number().min(0).nullable().optional(),
    archive_limit_bytes: z.number().min(0).nullable().optional(),
    export_retention_days: z.number().min(1).optional(),
    crash_report_retention_days: z.number().min(1).optional(),
    notification_retention_days: z.number().min(1).optional(),
    trimming_log_retention_days: z.number().min(1).optional(),
    auto_purge_enabled: z.boolean().optional(),
    auto_purge_threshold_percent: z.number().min(1).max(100).optional(),
    auto_purge_target_percent: z.number().min(1).max(100).optional(),
  }).refine(
    (data) => {
      if (data.auto_purge_target_percent !== undefined && data.auto_purge_threshold_percent !== undefined) {
        return data.auto_purge_target_percent < data.auto_purge_threshold_percent;
      }
      return true;
    },
    { message: 'auto_purge_target_percent must be less than auto_purge_threshold_percent' }
  );

  /**
   * PATCH /server/storage/limits - Update storage limits
   */
  fastify.patch('/storage/limits', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can update storage limits');
      }

      const parsed = storageLimitsUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return badRequest(reply, parsed.error.errors[0]?.message || 'Invalid input');
      }

      // Cross-validate against current values if only one of the pair is provided
      if (parsed.data.auto_purge_target_percent !== undefined || parsed.data.auto_purge_threshold_percent !== undefined) {
        const current = await getStorageLimits();
        const targetPct = parsed.data.auto_purge_target_percent ?? current.auto_purge_target_percent;
        const thresholdPct = parsed.data.auto_purge_threshold_percent ?? current.auto_purge_threshold_percent;
        if (targetPct >= thresholdPct) {
          return badRequest(reply, 'auto_purge_target_percent must be less than auto_purge_threshold_percent');
        }
      }

      return updateStorageLimits(parsed.data);
    },
  });

  const purgeCategoryEnum = z.enum([
    'channels', 'dms', 'emojis', 'stickers', 'profiles',
    'uploads', 'archives', 'exports',
    'crash_reports', 'notifications', 'trimming_log',
  ]);

  const purgeSchema = z.object({
    category: purgeCategoryEnum,
    percent: z.number().min(1).max(100).optional(),
    channel_id: z.string().uuid().optional(),
    older_than_days: z.number().min(1).optional(),
    dry_run: z.boolean().optional(),
  });

  /**
   * POST /server/storage/purge - Purge storage by category
   */
  fastify.post('/storage/purge', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can purge storage');
      }

      const parsed = purgeSchema.safeParse(request.body);
      if (!parsed.success) {
        return badRequest(reply, parsed.error.errors[0]?.message || 'Invalid input');
      }

      return purgeByCategory(server.id, parsed.data as { category: PurgeCategory } & typeof parsed.data);
    },
  });

  /**
   * POST /server/storage/auto-purge/run - Manually trigger auto-purge cycle
   */
  fastify.post('/storage/auto-purge/run', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      const perms = await calculatePermissions(request.user!.id, server.id);
      const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                      server.owner_id === request.user!.id;

      if (!isAdmin) {
        return forbidden(reply, 'Only administrators can trigger auto-purge');
      }

      return runAutoPurge(server.id);
    },
  });
};

// Export helper for other routes to use
export { getDefaultServer };
