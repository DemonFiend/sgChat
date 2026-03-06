import { sql } from '../lib/db.js';
import { db } from '../lib/db.js';
import { nanoid } from 'nanoid';
import { getDefaultPermissions } from './permissions.js';
import { permissionToString, RoleTemplates, ALL_PERMISSIONS, TextPermissions } from '@sgchat/shared';
import { emitEncrypted } from '../lib/socketEmit.js';
import { createDefaultGroups } from './roleReactions.js';

/**
 * Create a new server with default channels, categories, and roles
 */
export async function createServer(
  ownerId: string,
  name: string,
  iconUrl?: string
) {
  return sql.begin(async (tx: any) => {
    // 1. Create the server
    const [server] = await tx`
      INSERT INTO servers (name, owner_id, icon_url)
      VALUES (${name}, ${ownerId}, ${iconUrl || null})
      RETURNING *
    `;

    // 2. Get default permissions from instance settings
    const defaultPerms = await getDefaultPermissions();

    // 3. Create @everyone role (position 0 - lowest)
    const [everyoneRole] = await tx`
      INSERT INTO roles (
        server_id, name, position, color,
        server_permissions, text_permissions, voice_permissions,
        is_hoisted, is_mentionable, description
      )
      VALUES (
        ${server.id},
        '@everyone',
        0,
        NULL,
        ${permissionToString(defaultPerms.server)},
        ${permissionToString(defaultPerms.text)},
        ${permissionToString(defaultPerms.voice)},
        false,
        false,
        'Default role for all members'
      )
      RETURNING *
    `;

    // 4. Create default Admin role (highest position)
    const [adminRole] = await tx`
      INSERT INTO roles (
        server_id, name, position, color,
        server_permissions, text_permissions, voice_permissions,
        is_hoisted, is_mentionable, description
      )
      VALUES (
        ${server.id},
        ${RoleTemplates.ADMIN.name},
        100,
        ${RoleTemplates.ADMIN.color},
        ${permissionToString(RoleTemplates.ADMIN.server)},
        ${permissionToString(RoleTemplates.ADMIN.text)},
        ${permissionToString(RoleTemplates.ADMIN.voice)},
        ${RoleTemplates.ADMIN.hoist},
        ${RoleTemplates.ADMIN.mentionable},
        ${RoleTemplates.ADMIN.description}
      )
      RETURNING *
    `;

    // 5. Create default Moderator role
    const [moderatorRole] = await tx`
      INSERT INTO roles (
        server_id, name, position, color,
        server_permissions, text_permissions, voice_permissions,
        is_hoisted, is_mentionable, description
      )
      VALUES (
        ${server.id},
        ${RoleTemplates.MODERATOR.name},
        50,
        ${RoleTemplates.MODERATOR.color},
        ${permissionToString(RoleTemplates.MODERATOR.server)},
        ${permissionToString(RoleTemplates.MODERATOR.text)},
        ${permissionToString(RoleTemplates.MODERATOR.voice)},
        ${RoleTemplates.MODERATOR.hoist},
        ${RoleTemplates.MODERATOR.mentionable},
        ${RoleTemplates.MODERATOR.description}
      )
      RETURNING *
    `;

    // 6. Create default Member role
    const [memberRole] = await tx`
      INSERT INTO roles (
        server_id, name, position, color,
        server_permissions, text_permissions, voice_permissions,
        is_hoisted, is_mentionable, description
      )
      VALUES (
        ${server.id},
        ${RoleTemplates.MEMBER.name},
        10,
        ${RoleTemplates.MEMBER.color},
        ${permissionToString(RoleTemplates.MEMBER.server)},
        ${permissionToString(RoleTemplates.MEMBER.text)},
        ${permissionToString(RoleTemplates.MEMBER.voice)},
        ${RoleTemplates.MEMBER.hoist},
        ${RoleTemplates.MEMBER.mentionable},
        ${RoleTemplates.MEMBER.description}
      )
      RETURNING *
    `;

    // 7. Create default "Server Info" category
    const [serverInfoCategory] = await tx`
      INSERT INTO categories (server_id, name, position)
      VALUES (${server.id}, 'Server Info', 0)
      RETURNING *
    `;

    // 8. Create default "General Chat" category
    const [generalChatCategory] = await tx`
      INSERT INTO categories (server_id, name, position)
      VALUES (${server.id}, 'General Chat', 1)
      RETURNING *
    `;

    // 9. Create default "Voice Channels" category
    const [voiceCategory] = await tx`
      INSERT INTO categories (server_id, name, position)
      VALUES (${server.id}, 'Voice Channels', 2)
      RETURNING *
    `;

    // 9b. Create default "Temp Channels" category
    const [tempCategory] = await tx`
      INSERT INTO categories (server_id, name, position)
      VALUES (${server.id}, 'Temp Channels', 3)
      RETURNING *
    `;

    // --- Server Info channels ---

    // 10. Create #announcements channel (announcement type) in Server Info
    const [announcementsChannel] = await tx`
      INSERT INTO channels (
        server_id, name, type, topic, position, category_id
      )
      VALUES (
        ${server.id},
        'announcements',
        'announcement',
        'Important server announcements',
        0,
        ${serverInfoCategory.id}
      )
      RETURNING *
    `;

    // 11. Create #roles channel (text, read-only + reactions allowed) in Server Info
    const [rolesChannel] = await tx`
      INSERT INTO channels (
        server_id, name, type, topic, position, category_id
      )
      VALUES (
        ${server.id},
        'roles',
        'text',
        'React to assign yourself roles',
        1,
        ${serverInfoCategory.id}
      )
      RETURNING *
    `;

    // 11a. Deny @everyone SEND_MESSAGES on #roles (reactions still allowed by default perms)
    await tx`
      INSERT INTO channel_permission_overrides (
        channel_id, role_id, text_allow, text_deny
      )
      VALUES (
        ${rolesChannel.id},
        ${everyoneRole.id},
        '0',
        ${permissionToString(TextPermissions.SEND_MESSAGES)}
      )
    `;

    // --- General Chat channels ---

    // 12. Create #welcome text channel (read-only for @everyone) in General Chat
    const [welcomeChannel] = await tx`
      INSERT INTO channels (
        server_id, name, type, topic, position, category_id
      )
      VALUES (
        ${server.id},
        'welcome',
        'text',
        'Welcome new members! Join and leave messages appear here.',
        0,
        ${generalChatCategory.id}
      )
      RETURNING *
    `;

    // 12a. Deny @everyone SEND_MESSAGES on #welcome
    await tx`
      INSERT INTO channel_permission_overrides (
        channel_id, role_id, text_allow, text_deny
      )
      VALUES (
        ${welcomeChannel.id},
        ${everyoneRole.id},
        '0',
        ${permissionToString(TextPermissions.SEND_MESSAGES)}
      )
    `;

    // 13. Create #general text channel in General Chat
    const [generalChannel] = await tx`
      INSERT INTO channels (
        server_id, name, type, topic, position, category_id
      )
      VALUES (
        ${server.id},
        'general',
        'text',
        'General discussion',
        1,
        ${generalChatCategory.id}
      )
      RETURNING *
    `;

    // 14. Create #moderator-chat in General Chat (restricted to Moderator+)
    const [moderatorChannel] = await tx`
      INSERT INTO channels (
        server_id, name, type, topic, position, category_id
      )
      VALUES (
        ${server.id},
        'moderator-chat',
        'text',
        'Private channel for moderators and admins',
        2,
        ${generalChatCategory.id}
      )
      RETURNING *
    `;

    // 14a. Deny @everyone VIEW_CHANNEL on #moderator-chat
    await tx`
      INSERT INTO channel_permission_overrides (
        channel_id, role_id, text_allow, text_deny
      )
      VALUES (
        ${moderatorChannel.id},
        ${everyoneRole.id},
        '0',
        ${permissionToString(TextPermissions.VIEW_CHANNEL)}
      )
    `;

    // 14b. Allow Moderator VIEW_CHANNEL on #moderator-chat
    await tx`
      INSERT INTO channel_permission_overrides (
        channel_id, role_id, text_allow, text_deny
      )
      VALUES (
        ${moderatorChannel.id},
        ${moderatorRole.id},
        ${permissionToString(TextPermissions.VIEW_CHANNEL)},
        '0'
      )
    `;

    // --- Voice Channels ---

    // 15. Create Lounge voice channel in Voice Channels
    const [loungeVoice] = await tx`
      INSERT INTO channels (
        server_id, name, type, position, bitrate, category_id
      )
      VALUES (
        ${server.id},
        'Lounge',
        'voice',
        0,
        64000,
        ${voiceCategory.id}
      )
      RETURNING *
    `;

    // 16. Create Music/Stage channel (music type) in Voice Channels
    const [musicChannel] = await tx`
      INSERT INTO channels (
        server_id, name, type, position, bitrate, category_id
      )
      VALUES (
        ${server.id},
        'Music/Stage',
        'music',
        1,
        128000,
        ${voiceCategory.id}
      )
      RETURNING *
    `;

    // 17. Create AFK Channel in Voice Channels
    const [afkChannel] = await tx`
      INSERT INTO channels (
        server_id, name, type, position, bitrate, is_afk_channel, category_id
      )
      VALUES (
        ${server.id},
        'AFK Channel',
        'voice',
        2,
        8000,
        true,
        ${voiceCategory.id}
      )
      RETURNING *
    `;

    // 17b. Create Temp VC generator channel in Temp Channels category
    const [tempVcGenerator] = await tx`
      INSERT INTO channels (
        server_id, name, type, position, bitrate, user_limit, category_id
      )
      VALUES (
        ${server.id},
        'Create Temp VC',
        'temp_voice_generator',
        0,
        64000,
        0,
        ${tempCategory.id}
      )
      RETURNING *
    `;

    // 18. Update server with special channel references
    await tx`
      UPDATE servers
      SET welcome_channel_id = ${welcomeChannel.id},
          afk_channel_id = ${afkChannel.id}
      WHERE id = ${server.id}
    `;

    // 19. Add owner as member
    await tx`
      INSERT INTO members (user_id, server_id)
      VALUES (${ownerId}, ${server.id})
    `;

    // 20. Assign Admin role to owner
    await tx`
      INSERT INTO member_roles (member_user_id, member_server_id, role_id)
      VALUES (${ownerId}, ${server.id}, ${adminRole.id})
    `;

    // 21. Set up default role reactions in #roles channel
    await createDefaultGroups(server.id, rolesChannel.id, tx);

    // Return server with channels, categories, and roles
    return {
      ...server,
      welcome_channel_id: welcomeChannel.id,
      afk_channel_id: afkChannel.id,
      channels: [
        announcementsChannel,
        rolesChannel,
        welcomeChannel,
        generalChannel,
        moderatorChannel,
        loungeVoice,
        musicChannel,
        afkChannel,
        tempVcGenerator,
      ],
      categories: [serverInfoCategory, generalChatCategory, voiceCategory, tempCategory],
      roles: [everyoneRole, adminRole, moderatorRole, memberRole],
    };
  });
}

/**
 * Handle member joining a server
 */
export async function handleMemberJoin(
  userId: string,
  serverId: string,
  io?: any
) {
  return sql.begin(async (tx: any) => {
    // Add member
    const [member] = await tx`
      INSERT INTO members (user_id, server_id)
      VALUES (${userId}, ${serverId})
      RETURNING *
    `;

    // Get user and server info
    const [user] = await tx`SELECT * FROM users WHERE id = ${userId}`;
    const [server] = await tx`SELECT * FROM servers WHERE id = ${serverId}`;

    // Emit member:join event to all connected clients in the server
    if (io) {
      await emitEncrypted(io, `server:${serverId}`, 'member.join', {
        member: {
          id: user.id,
          username: user.username,
          display_name: user.display_name || user.username,
          avatar_url: user.avatar_url,
          status: user.status || 'offline',
          custom_status: user.custom_status,
          role_color: null, // New members have no roles yet
        },
      });
    }

    // Post system message to welcome channel if configured
    if (server.welcome_channel_id && server.announce_joins) {
      const [message] = await tx`
        INSERT INTO messages (
          channel_id, author_id, content, system_event
        )
        VALUES (
          ${server.welcome_channel_id},
          NULL,
          ${`${user.username} joined the server`},
          ${JSON.stringify({
        type: 'member_join',
        user_id: userId,
        username: user.username,
        timestamp: new Date(),
      })}
        )
        RETURNING *
      `;

      // Broadcast to channel via Socket.IO
      if (io) {
        await emitEncrypted(io, `channel:${server.welcome_channel_id}`, 'message.new', {
          ...message,
          type: 'system',
        });
      }
    }

    return member;
  });
}

/**
 * Handle member leaving a server
 */
export async function handleMemberLeave(
  userId: string,
  serverId: string,
  io?: any
) {
  return sql.begin(async (tx: any) => {
    // Get user and server info before deletion
    const [user] = await tx`SELECT * FROM users WHERE id = ${userId}`;
    const [server] = await tx`SELECT * FROM servers WHERE id = ${serverId}`;

    // Emit member:leave event to all connected clients in the server
    if (io) {
      await emitEncrypted(io, `server:${serverId}`, 'member.leave', {
        user_id: userId,
      });
    }

    // Post leave message to welcome channel if configured
    if (server.welcome_channel_id && server.announce_leaves) {
      const [message] = await tx`
        INSERT INTO messages (
          channel_id, author_id, content, system_event
        )
        VALUES (
          ${server.welcome_channel_id},
          NULL,
          ${`${user.username} left the server`},
          ${JSON.stringify({
        type: 'member_leave',
        user_id: userId,
        username: user.username,
        timestamp: new Date(),
      })}
        )
        RETURNING *
      `;

      // Broadcast to channel via Socket.IO
      if (io) {
        await emitEncrypted(io, `channel:${server.welcome_channel_id}`, 'message.new', {
          ...message,
          type: 'system',
        });
      }
    }

    // Delete member (cascades to member_roles)
    await tx`
      DELETE FROM members
      WHERE user_id = ${userId} AND server_id = ${serverId}
    `;
  });
}

/**
 * Create a role from template
 */
export async function createRoleFromTemplate(
  serverId: string,
  templateName: keyof typeof RoleTemplates,
  position?: number
) {
  const template = RoleTemplates[templateName];
  if (!template) {
    throw new Error('Invalid template name');
  }

  // Get the next available position if not specified
  let rolePosition: number = position ?? 0;
  if (position === undefined) {
    const [maxPos] = await sql`
      SELECT COALESCE(MAX(position), 0) + 1 as next_position
      FROM roles
      WHERE server_id = ${serverId}
    `;
    rolePosition = Number(maxPos.next_position) || 0;
  }

  const [role] = await sql`
    INSERT INTO roles (
      server_id, name, position, color,
      server_permissions, text_permissions, voice_permissions,
      is_hoisted, is_mentionable, description
    )
    VALUES (
      ${serverId},
      ${template.name},
      ${rolePosition},
      ${template.color || null},
      ${permissionToString(template.server)},
      ${permissionToString(template.text)},
      ${permissionToString(template.voice)},
      ${template.hoist ?? false},
      ${template.mentionable ?? false},
      ${template.description || null}
    )
    RETURNING *
  `;

  return role;
}

/**
 * Generate unique invite code
 */
export async function generateInviteCode(): Promise<string> {
  let code: string;
  let exists = true;

  while (exists) {
    code = nanoid(8);
    const existing = await db.invites.findByCode(code);
    exists = !!existing;
  }

  return code!;
}
