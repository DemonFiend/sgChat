/**
 * Server Popup Configuration Routes
 * Allows admins to configure the welcome popup shown to users
 */
import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { hasPermission, ServerPermissions } from '@sgchat/shared';
import { calculatePermissions } from '../services/permissions.js';
import { forbidden, notFound, badRequest } from '../utils/errors.js';
import { updatePopupConfigSchema } from '@sgchat/shared';
import type { ServerPopupConfig } from '@sgchat/shared';

/**
 * Get the default/primary server for single-tenant mode
 */
async function getDefaultServer() {
    const [server] = await db.sql`
    SELECT * FROM servers 
    ORDER BY created_at ASC 
    LIMIT 1
  `;
    return server;
}

export const serverPopupConfigRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /server/popup-config - Get server popup configuration
     * Returns current config merged with server defaults
     */
    fastify.get('/', {
        onRequest: [authenticate],
        handler: async (request, reply) => {
            const server = await getDefaultServer();

            if (!server) {
                return notFound(reply, 'Server');
            }

            // Check if user has MANAGE_SERVER permission
            const perms = await calculatePermissions(request.user!.id, server.id);
            const canManage = hasPermission(perms.server, ServerPermissions.MANAGE_SERVER) ||
                hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                server.owner_id === request.user!.id;

            if (!canManage) {
                return forbidden(reply, 'You need MANAGE_SERVER permission to view popup configuration');
            }

            // Parse popup_config from JSONB, with defaults
            const popupConfig = server.popup_config || {};

            const response: ServerPopupConfig = {
                serverId: server.id,
                serverName: popupConfig.serverName || server.name,
                serverIconUrl: popupConfig.serverIconUrl || server.icon_url || null,
                bannerUrl: popupConfig.bannerUrl || server.banner_url || null,
                timeFormat: popupConfig.timeFormat || '24h',
                motd: popupConfig.motd !== undefined ? popupConfig.motd : server.motd,
                welcomeMessage: popupConfig.welcomeMessage !== undefined ? popupConfig.welcomeMessage : server.welcome_message,
                events: popupConfig.events || [],
            };

            return response;
        },
    });

    /**
     * PUT /server/popup-config - Update server popup configuration
     * Requires MANAGE_SERVER permission or higher
     */
    fastify.put('/', {
        onRequest: [authenticate],
        handler: async (request, reply) => {
            const server = await getDefaultServer();

            if (!server) {
                return notFound(reply, 'Server');
            }

            // Check permissions
            const perms = await calculatePermissions(request.user!.id, server.id);
            const canManage = hasPermission(perms.server, ServerPermissions.MANAGE_SERVER) ||
                hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                server.owner_id === request.user!.id;

            if (!canManage) {
                return forbidden(reply, 'You need MANAGE_SERVER permission to modify popup configuration');
            }

            // Validate input
            const body = updatePopupConfigSchema.parse(request.body);

            // Get current config
            const currentConfig = server.popup_config || {};

            // Merge updates with current config
            const updatedConfig: any = {
                serverName: body.serverName !== undefined ? body.serverName : currentConfig.serverName,
                serverIconUrl: body.serverIconUrl !== undefined ? body.serverIconUrl : currentConfig.serverIconUrl,
                bannerUrl: body.bannerUrl !== undefined ? body.bannerUrl : currentConfig.bannerUrl,
                timeFormat: body.timeFormat !== undefined ? body.timeFormat : (currentConfig.timeFormat || '24h'),
                motd: body.motd !== undefined ? body.motd : currentConfig.motd,
                welcomeMessage: body.welcomeMessage !== undefined ? body.welcomeMessage : currentConfig.welcomeMessage,
                events: body.events !== undefined ? body.events : (currentConfig.events || []),
            };

            // Update database
            await db.sql`
        UPDATE servers
        SET popup_config = ${JSON.stringify(updatedConfig)}
        WHERE id = ${server.id}
      `;

            // Audit log
            await db.sql`
        INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
        VALUES (${server.id}, ${request.user!.id}, 'popup_config_update', 'server', ${server.id}, ${JSON.stringify(body)})
      `.catch(() => {
                // Audit log is optional, don't fail the request if it fails
            });

            // Broadcast update to connected clients
            fastify.io?.to(`server:${server.id}`).emit('server.popup_config.update', updatedConfig);

            // Return updated config
            const response: ServerPopupConfig = {
                serverId: server.id,
                serverName: updatedConfig.serverName || server.name,
                serverIconUrl: updatedConfig.serverIconUrl || null,
                bannerUrl: updatedConfig.bannerUrl || null,
                timeFormat: updatedConfig.timeFormat,
                motd: updatedConfig.motd,
                welcomeMessage: updatedConfig.welcomeMessage,
                events: updatedConfig.events,
            };

            return response;
        },
    });

    /**
     * GET /server/popup-data - Get public popup data for display
     * This endpoint is for the client-side popup component (non-admin users)
     * Returns only the fields needed to render the popup
     */
    fastify.get('/data', {
        onRequest: [authenticate],
        handler: async (request, reply) => {
            const server = await getDefaultServer();

            if (!server) {
                return notFound(reply, 'Server');
            }

            const popupConfig = server.popup_config || {};

            return {
                serverName: popupConfig.serverName || server.name,
                bannerUrl: popupConfig.bannerUrl || server.banner_url || null,
                timeFormat: popupConfig.timeFormat || '24h',
                motd: popupConfig.motd !== undefined ? popupConfig.motd : server.motd,
                welcomeMessage: popupConfig.welcomeMessage !== undefined ? popupConfig.welcomeMessage : server.welcome_message,
                timezone: server.timezone || 'UTC',
                events: popupConfig.events || [],
            };
        },
    });
};
