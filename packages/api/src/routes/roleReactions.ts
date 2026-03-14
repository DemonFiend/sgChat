import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db, sql } from '../lib/db.js';
import { publishEvent } from '../lib/eventBus.js';
import { calculatePermissions } from '../services/permissions.js';
import { ServerPermissions, hasPermission } from '@sgchat/shared';
import { notFound, badRequest, forbidden, conflict } from '../utils/errors.js';
import {
  createRoleReactionGroupSchema,
  updateRoleReactionGroupSchema,
  toggleRoleReactionGroupSchema,
  createRoleReactionMappingSchema,
  updateRoleReactionMappingSchema,
  reorderRoleReactionMappingsSchema,
  roleReactionSetupSchema,
  formatChannelSchema,
} from '@sgchat/shared';
import {
  createDefaultGroups,
  getGroupsForServer,
  postRoleReactionMessage,
  refreshGroupMessage,
  refreshAllGroupMessages,
  stripRolesForGroup,
  countNonRoleMessages,
  formatChannel,
} from '../services/roleReactions.js';

async function requireManageRoles(request: any, reply: any, serverId: string) {
  const perms = await calculatePermissions(request.user!.id, serverId);
  if (!perms.isOwner && !hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) &&
      !hasPermission(perms.server, ServerPermissions.MANAGE_ROLES)) {
    return forbidden(reply, 'Requires MANAGE_ROLES permission');
  }
  return null;
}

export const roleReactionRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /:serverId/role-reactions - List all groups with mappings
   */
  fastify.get('/:serverId/role-reactions', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const denied = await requireManageRoles(request, reply, serverId);
      if (denied) return denied;

      const groups = await getGroupsForServer(serverId);
      return { groups };
    },
  });

  /**
   * POST /:serverId/role-reactions/refresh - Refresh all group messages (regenerate content)
   */
  fastify.post('/:serverId/role-reactions/refresh', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const denied = await requireManageRoles(request, reply, serverId);
      if (denied) return denied;

      const count = await refreshAllGroupMessages(serverId);
      return { refreshed: count };
    },
  });

  /**
   * POST /:serverId/role-reactions/setup - Initialize with 7 default groups
   */
  fastify.post('/:serverId/role-reactions/setup', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const denied = await requireManageRoles(request, reply, serverId);
      if (denied) return denied;

      const body = roleReactionSetupSchema.parse(request.body);

      // Verify channel exists and belongs to this server
      const channel = await db.channels.findById(body.channel_id);
      if (!channel || channel.server_id !== serverId) {
        return notFound(reply, 'Channel');
      }

      // Check if already set up
      const existing = await sql`
        SELECT COUNT(*)::int as count FROM role_reaction_groups WHERE server_id = ${serverId}
      `;
      if (existing[0].count > 0) {
        return badRequest(reply, 'Role reactions are already set up. Delete existing groups first or add new ones manually.');
      }

      const groups = await createDefaultGroups(serverId, body.channel_id);

      // Broadcast message.new for each group's message
      for (const group of groups) {
        if (group.message_id) {
          const [message] = await sql`
            SELECT * FROM messages WHERE id = ${group.message_id}
          `;
          if (message) {
            await publishEvent({
              type: 'message.new',
              resourceId: `channel:${body.channel_id}`,
              actorId: null,
              payload: { ...message, type: 'role_reaction' },
            });
          }
        }
      }

      // Audit log
      await sql`
        INSERT INTO audit_log (server_id, user_id, action, changes)
        VALUES (${serverId}, ${request.user!.id}, 'role_reaction_setup', ${JSON.stringify({
          channel_id: body.channel_id,
          groups_created: groups.length,
        })})
      `;

      return { groups };
    },
  });

  /**
   * POST /:serverId/role-reactions/groups - Create a new group
   */
  fastify.post('/:serverId/role-reactions/groups', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const denied = await requireManageRoles(request, reply, serverId);
      if (denied) return denied;

      const body = createRoleReactionGroupSchema.parse(request.body);

      // Verify channel belongs to server
      const channel = await db.channels.findById(body.channel_id);
      if (!channel || channel.server_id !== serverId) {
        return notFound(reply, 'Channel');
      }

      // Check name uniqueness
      const [existing] = await sql`
        SELECT 1 FROM role_reaction_groups WHERE server_id = ${serverId} AND name = ${body.name}
      `;
      if (existing) {
        return conflict(reply, 'A role reaction group with this name already exists');
      }

      const [group] = await sql`
        INSERT INTO role_reaction_groups (
          server_id, channel_id, name, description, position, enabled, remove_roles_on_disable, exclusive
        )
        VALUES (
          ${serverId}, ${body.channel_id}, ${body.name},
          ${body.description || null},
          ${body.position ?? 0},
          ${body.enabled ?? true},
          ${body.remove_roles_on_disable ?? true},
          ${body.exclusive ?? false}
        )
        RETURNING *
      `;

      // If enabled, post an empty message (mappings added later)
      if (group.enabled) {
        const message = await postRoleReactionMessage(
          sql, group.id, serverId, body.channel_id,
          group.name, group.description || null, [],
          body.exclusive ?? false
        );

        await publishEvent({
          type: 'message.new',
          resourceId: `channel:${body.channel_id}`,
          actorId: null,
          payload: { ...message, type: 'role_reaction' },
        });

        group.message_id = message.id;
      }

      await sql`
        INSERT INTO audit_log (server_id, user_id, action, changes)
        VALUES (${serverId}, ${request.user!.id}, 'role_reaction_group_create', ${JSON.stringify({
          group_id: group.id,
          name: group.name,
        })})
      `;

      return { group: { ...group, mappings: [] } };
    },
  });

  /**
   * PATCH /:serverId/role-reactions/groups/:groupId - Update a group
   */
  fastify.patch('/:serverId/role-reactions/groups/:groupId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId, groupId } = request.params as { serverId: string; groupId: string };

      const denied = await requireManageRoles(request, reply, serverId);
      if (denied) return denied;

      const body = updateRoleReactionGroupSchema.parse(request.body);

      const [group] = await sql`
        SELECT * FROM role_reaction_groups WHERE id = ${groupId} AND server_id = ${serverId}
      `;
      if (!group) return notFound(reply, 'Role reaction group');

      // If changing channel, need to move the message
      const newChannelId = body.channel_id;
      const channelChanged = newChannelId && newChannelId !== group.channel_id;

      if (channelChanged) {
        const channel = await db.channels.findById(newChannelId);
        if (!channel || channel.server_id !== serverId) {
          return notFound(reply, 'Channel');
        }

        // Delete old message
        if (group.message_id) {
          await sql`DELETE FROM messages WHERE id = ${group.message_id}`;
          await publishEvent({
            type: 'message.delete',
            resourceId: `channel:${group.channel_id}`,
            actorId: null,
            payload: { id: group.message_id, channel_id: group.channel_id },
          });
        }
      }

      // Update group
      const [updated] = await sql`
        UPDATE role_reaction_groups SET
          name = COALESCE(${body.name ?? null}, name),
          description = COALESCE(${body.description !== undefined ? body.description : null}, description),
          channel_id = COALESCE(${body.channel_id ?? null}, channel_id),
          position = COALESCE(${body.position ?? null}, position),
          remove_roles_on_disable = COALESCE(${body.remove_roles_on_disable ?? null}, remove_roles_on_disable),
          exclusive = COALESCE(${body.exclusive ?? null}, exclusive),
          message_id = ${channelChanged ? null : sql`message_id`},
          updated_at = NOW()
        WHERE id = ${groupId}
        RETURNING *
      `;

      // If channel changed and group is enabled, post new message
      if (channelChanged && updated.enabled) {
        const mappings = await sql`
          SELECT rrm.*, r.name as role_name, r.color as role_color,
            e.shortcode as custom_emoji_shortcode
          FROM role_reaction_mappings rrm
          JOIN roles r ON rrm.role_id = r.id
          LEFT JOIN emojis e ON rrm.custom_emoji_id = e.id
          WHERE rrm.group_id = ${groupId}
          ORDER BY rrm.position ASC
        `;
        const message = await postRoleReactionMessage(
          sql, groupId, serverId, newChannelId!,
          updated.name, updated.description, mappings,
          updated.exclusive
        );
        await publishEvent({
          type: 'message.new',
          resourceId: `channel:${newChannelId}`,
          actorId: null,
          payload: { ...message, type: 'role_reaction' },
        });
      } else if (!channelChanged && updated.message_id) {
        // Just refresh the message content if name/description changed
        await refreshGroupMessage(groupId);
      }

      await sql`
        INSERT INTO audit_log (server_id, user_id, action, changes)
        VALUES (${serverId}, ${request.user!.id}, 'role_reaction_group_update', ${JSON.stringify({
          group_id: groupId,
          changes: body,
        })})
      `;

      const mappings = await sql`
        SELECT rrm.*, r.name as role_name, r.color as role_color
        FROM role_reaction_mappings rrm
        JOIN roles r ON rrm.role_id = r.id
        WHERE rrm.group_id = ${groupId}
        ORDER BY rrm.position ASC
      `;

      return { group: { ...updated, mappings } };
    },
  });

  /**
   * DELETE /:serverId/role-reactions/groups/:groupId - Delete a group
   */
  fastify.delete('/:serverId/role-reactions/groups/:groupId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId, groupId } = request.params as { serverId: string; groupId: string };

      const denied = await requireManageRoles(request, reply, serverId);
      if (denied) return denied;

      const removeRoles = (request.query as any)?.remove_roles === 'true';

      const [group] = await sql`
        SELECT * FROM role_reaction_groups WHERE id = ${groupId} AND server_id = ${serverId}
      `;
      if (!group) return notFound(reply, 'Role reaction group');

      let rolesRemoved = 0;
      if (removeRoles) {
        rolesRemoved = await stripRolesForGroup(groupId);
      }

      // Delete message if exists
      if (group.message_id) {
        await sql`DELETE FROM messages WHERE id = ${group.message_id}`;
        await publishEvent({
          type: 'message.delete',
          resourceId: `channel:${group.channel_id}`,
          actorId: null,
          payload: { id: group.message_id, channel_id: group.channel_id },
        });
      }

      // Delete group (cascades to mappings)
      await sql`DELETE FROM role_reaction_groups WHERE id = ${groupId}`;

      await sql`
        INSERT INTO audit_log (server_id, user_id, action, changes)
        VALUES (${serverId}, ${request.user!.id}, 'role_reaction_group_delete', ${JSON.stringify({
          group_id: groupId,
          name: group.name,
          roles_removed: rolesRemoved,
        })})
      `;

      return { success: true, roles_removed: rolesRemoved };
    },
  });

  /**
   * PATCH /:serverId/role-reactions/groups/:groupId/toggle - Enable/disable
   */
  fastify.patch('/:serverId/role-reactions/groups/:groupId/toggle', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId, groupId } = request.params as { serverId: string; groupId: string };

      const denied = await requireManageRoles(request, reply, serverId);
      if (denied) return denied;

      const body = toggleRoleReactionGroupSchema.parse(request.body);

      const [group] = await sql`
        SELECT * FROM role_reaction_groups WHERE id = ${groupId} AND server_id = ${serverId}
      `;
      if (!group) return notFound(reply, 'Role reaction group');

      if (group.enabled === body.enabled) {
        return badRequest(reply, `Group is already ${body.enabled ? 'enabled' : 'disabled'}`);
      }

      if (!body.enabled) {
        // Disabling: delete message
        if (group.message_id) {
          await sql`DELETE FROM messages WHERE id = ${group.message_id}`;
          await publishEvent({
            type: 'message.delete',
            resourceId: `channel:${group.channel_id}`,
            actorId: null,
            payload: { id: group.message_id, channel_id: group.channel_id },
          });
        }

        // Optionally strip roles
        let rolesRemoved = 0;
        const shouldRemoveRoles = body.remove_roles ?? group.remove_roles_on_disable;
        if (shouldRemoveRoles) {
          rolesRemoved = await stripRolesForGroup(groupId);
        }

        await sql`
          UPDATE role_reaction_groups
          SET enabled = false, message_id = NULL, updated_at = NOW()
          WHERE id = ${groupId}
        `;

        const mappings = await sql`
          SELECT rrm.*, r.name as role_name, r.color as role_color
          FROM role_reaction_mappings rrm
          JOIN roles r ON rrm.role_id = r.id
          WHERE rrm.group_id = ${groupId}
          ORDER BY rrm.position ASC
        `;

        await sql`
          INSERT INTO audit_log (server_id, user_id, action, changes)
          VALUES (${serverId}, ${request.user!.id}, 'role_reaction_group_toggle', ${JSON.stringify({
            group_id: groupId,
            enabled: false,
            roles_removed: rolesRemoved,
          })})
        `;

        return {
          group: { ...group, enabled: false, message_id: null, mappings },
          roles_removed: rolesRemoved,
        };
      } else {
        // Enabling: post new message
        const mappings = await sql`
          SELECT rrm.*, r.name as role_name, r.color as role_color,
            e.shortcode as custom_emoji_shortcode
          FROM role_reaction_mappings rrm
          JOIN roles r ON rrm.role_id = r.id
          LEFT JOIN emojis e ON rrm.custom_emoji_id = e.id
          WHERE rrm.group_id = ${groupId}
          ORDER BY rrm.position ASC
        `;

        const message = await postRoleReactionMessage(
          sql, groupId, serverId, group.channel_id,
          group.name, group.description, mappings,
          group.exclusive
        );

        await sql`
          UPDATE role_reaction_groups
          SET enabled = true, updated_at = NOW()
          WHERE id = ${groupId}
        `;

        await publishEvent({
          type: 'message.new',
          resourceId: `channel:${group.channel_id}`,
          actorId: null,
          payload: { ...message, type: 'role_reaction' },
        });

        await sql`
          INSERT INTO audit_log (server_id, user_id, action, changes)
          VALUES (${serverId}, ${request.user!.id}, 'role_reaction_group_toggle', ${JSON.stringify({
            group_id: groupId,
            enabled: true,
          })})
        `;

        return {
          group: { ...group, enabled: true, message_id: message.id, mappings },
        };
      }
    },
  });

  /**
   * POST /:serverId/role-reactions/groups/:groupId/mappings - Add mapping
   */
  fastify.post('/:serverId/role-reactions/groups/:groupId/mappings', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId, groupId } = request.params as { serverId: string; groupId: string };

      const denied = await requireManageRoles(request, reply, serverId);
      if (denied) return denied;

      const body = createRoleReactionMappingSchema.parse(request.body);

      // Verify group exists
      const [group] = await sql`
        SELECT * FROM role_reaction_groups WHERE id = ${groupId} AND server_id = ${serverId}
      `;
      if (!group) return notFound(reply, 'Role reaction group');

      // Verify role exists and belongs to this server
      const [role] = await sql`
        SELECT * FROM roles WHERE id = ${body.role_id} AND server_id = ${serverId}
      `;
      if (!role) return notFound(reply, 'Role');

      // Check emoji uniqueness within group
      const [existingEmoji] = await sql`
        SELECT 1 FROM role_reaction_mappings WHERE group_id = ${groupId} AND emoji = ${body.emoji}
      `;
      if (existingEmoji) {
        return conflict(reply, 'This emoji is already used in this group');
      }

      // Get next position
      const [maxPos] = await sql`
        SELECT COALESCE(MAX(position), -1)::int + 1 as next_position
        FROM role_reaction_mappings WHERE group_id = ${groupId}
      `;

      const emojiType = body.emoji_type || 'unicode';
      const customEmojiId = emojiType === 'custom' ? (body.custom_emoji_id || null) : null;

      const [mapping] = await sql`
        INSERT INTO role_reaction_mappings (group_id, role_id, emoji, emoji_type, custom_emoji_id, label, position)
        VALUES (${groupId}, ${body.role_id}, ${body.emoji}, ${emojiType}, ${customEmojiId}, ${body.label || null}, ${maxPos.next_position})
        RETURNING *
      `;

      // Refresh the group message to show the new mapping
      await refreshGroupMessage(groupId);

      // Add the emoji reaction to the message
      if (group.message_id) {
        const server = await db.servers.findById(serverId);
        if (server) {
          if (emojiType === 'custom' && customEmojiId) {
            await sql`
              INSERT INTO message_reactions (message_id, user_id, reaction_type, custom_emoji_id)
              VALUES (${group.message_id}, ${server.owner_id}, 'custom', ${customEmojiId})
              ON CONFLICT DO NOTHING
            `;
          } else {
            await sql`
              INSERT INTO message_reactions (message_id, user_id, reaction_type, unicode_emoji)
              VALUES (${group.message_id}, ${server.owner_id}, 'unicode', ${body.emoji})
              ON CONFLICT DO NOTHING
            `;
          }
        }
      }

      return {
        mapping: { ...mapping, role_name: role.name, role_color: role.color },
      };
    },
  });

  /**
   * PATCH /:serverId/role-reactions/groups/:groupId/mappings/:mappingId - Update mapping
   */
  fastify.patch('/:serverId/role-reactions/groups/:groupId/mappings/:mappingId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId, groupId, mappingId } = request.params as {
        serverId: string; groupId: string; mappingId: string;
      };

      const denied = await requireManageRoles(request, reply, serverId);
      if (denied) return denied;

      const body = updateRoleReactionMappingSchema.parse(request.body);

      const [group] = await sql`
        SELECT * FROM role_reaction_groups WHERE id = ${groupId} AND server_id = ${serverId}
      `;
      if (!group) return notFound(reply, 'Role reaction group');

      const [existing] = await sql`
        SELECT * FROM role_reaction_mappings WHERE id = ${mappingId} AND group_id = ${groupId}
      `;
      if (!existing) return notFound(reply, 'Mapping');

      // Check emoji uniqueness if changing
      if (body.emoji && body.emoji !== existing.emoji) {
        const [dup] = await sql`
          SELECT 1 FROM role_reaction_mappings
          WHERE group_id = ${groupId} AND emoji = ${body.emoji} AND id != ${mappingId}
        `;
        if (dup) return conflict(reply, 'This emoji is already used in this group');
      }

      // Check role if changing
      if (body.role_id && body.role_id !== existing.role_id) {
        const [role] = await sql`
          SELECT 1 FROM roles WHERE id = ${body.role_id} AND server_id = ${serverId}
        `;
        if (!role) return notFound(reply, 'Role');
      }

      const [updated] = await sql`
        UPDATE role_reaction_mappings SET
          emoji = COALESCE(${body.emoji ?? null}, emoji),
          emoji_type = COALESCE(${body.emoji_type ?? null}, emoji_type),
          custom_emoji_id = ${body.emoji_type === 'custom' ? (body.custom_emoji_id || null) : (body.emoji_type === 'unicode' ? null : existing.custom_emoji_id)},
          role_id = COALESCE(${body.role_id ?? null}, role_id),
          label = COALESCE(${body.label !== undefined ? body.label : null}, label)
        WHERE id = ${mappingId}
        RETURNING *
      `;

      const [role] = await sql`
        SELECT name, color FROM roles WHERE id = ${updated.role_id}
      `;

      await refreshGroupMessage(groupId);

      return {
        mapping: { ...updated, role_name: role?.name, role_color: role?.color },
      };
    },
  });

  /**
   * DELETE /:serverId/role-reactions/groups/:groupId/mappings/:mappingId - Remove mapping
   */
  fastify.delete('/:serverId/role-reactions/groups/:groupId/mappings/:mappingId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId, groupId, mappingId } = request.params as {
        serverId: string; groupId: string; mappingId: string;
      };

      const denied = await requireManageRoles(request, reply, serverId);
      if (denied) return denied;

      const [group] = await sql`
        SELECT * FROM role_reaction_groups WHERE id = ${groupId} AND server_id = ${serverId}
      `;
      if (!group) return notFound(reply, 'Role reaction group');

      const [mapping] = await sql`
        SELECT * FROM role_reaction_mappings WHERE id = ${mappingId} AND group_id = ${groupId}
      `;
      if (!mapping) return notFound(reply, 'Mapping');

      await sql`DELETE FROM role_reaction_mappings WHERE id = ${mappingId}`;

      // Refresh the group message
      await refreshGroupMessage(groupId);

      return { success: true };
    },
  });

  /**
   * PATCH /:serverId/role-reactions/groups/:groupId/mappings/reorder
   */
  fastify.patch('/:serverId/role-reactions/groups/:groupId/mappings/reorder', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId, groupId } = request.params as { serverId: string; groupId: string };

      const denied = await requireManageRoles(request, reply, serverId);
      if (denied) return denied;

      const body = reorderRoleReactionMappingsSchema.parse(request.body);

      const [group] = await sql`
        SELECT * FROM role_reaction_groups WHERE id = ${groupId} AND server_id = ${serverId}
      `;
      if (!group) return notFound(reply, 'Role reaction group');

      // Update positions
      for (let i = 0; i < body.mapping_ids.length; i++) {
        await sql`
          UPDATE role_reaction_mappings
          SET position = ${i}
          WHERE id = ${body.mapping_ids[i]} AND group_id = ${groupId}
        `;
      }

      // Refresh message to reflect new order
      await refreshGroupMessage(groupId);

      const mappings = await sql`
        SELECT rrm.*, r.name as role_name, r.color as role_color
        FROM role_reaction_mappings rrm
        JOIN roles r ON rrm.role_id = r.id
        WHERE rrm.group_id = ${groupId}
        ORDER BY rrm.position ASC
      `;

      return { mappings };
    },
  });

  /**
   * GET /:serverId/role-reactions/format-channel/preview - Preview format operation
   */
  fastify.get('/:serverId/role-reactions/format-channel/preview', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const denied = await requireManageRoles(request, reply, serverId);
      if (denied) return denied;

      const channelId = (request.query as any)?.channel_id;
      if (!channelId) return badRequest(reply, 'channel_id query parameter required');

      const channel = await db.channels.findById(channelId);
      if (!channel || channel.server_id !== serverId) {
        return notFound(reply, 'Channel');
      }

      const messageCount = await countNonRoleMessages(channelId);

      const [groupCount] = await sql`
        SELECT COUNT(*)::int as count
        FROM role_reaction_groups
        WHERE channel_id = ${channelId} AND enabled = true
      `;

      return {
        messages_to_delete: messageCount,
        groups_to_repost: groupCount.count,
        channel_name: channel.name,
      };
    },
  });

  /**
   * POST /:serverId/role-reactions/format-channel - Format channel
   */
  fastify.post('/:serverId/role-reactions/format-channel', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.params as { serverId: string };

      const denied = await requireManageRoles(request, reply, serverId);
      if (denied) return denied;

      const body = formatChannelSchema.parse(request.body);

      const channel = await db.channels.findById(body.channel_id);
      if (!channel || channel.server_id !== serverId) {
        return notFound(reply, 'Channel');
      }

      const result = await formatChannel(serverId, body.channel_id);

      await sql`
        INSERT INTO audit_log (server_id, user_id, action, changes)
        VALUES (${serverId}, ${request.user!.id}, 'role_reaction_format_channel', ${JSON.stringify({
          channel_id: body.channel_id,
          channel_name: channel.name,
          messages_deleted: result.messages_deleted,
          groups_reposted: result.groups_reposted,
        })})
      `;

      // Publish channel update so clients refresh their message list
      await publishEvent({
        type: 'channel.update',
        resourceId: `server:${serverId}`,
        actorId: request.user!.id,
        payload: { id: body.channel_id, server_id: serverId },
      });

      return result;
    },
  });
};
