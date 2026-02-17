import { sql } from '../lib/db.js';
import { db } from '../lib/db.js';
import { nanoid } from 'nanoid';
import { getDefaultPermissions } from './permissions.js';
import { permissionToString, RoleTemplates, ALL_PERMISSIONS } from '@sgchat/shared';

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

    // 7. Create default "Server Misc" category
    const [serverMiscCategory] = await tx`
      INSERT INTO categories (server_id, name, position)
      VALUES (${server.id}, 'Server Misc', 0)
      RETURNING *
    `;

    // 8. Create default "Social" category
    const [socialCategory] = await tx`
      INSERT INTO categories (server_id, name, position)
      VALUES (${server.id}, 'Social', 1)
      RETURNING *
    `;

    // 9. Create default "Misc" category
    const [miscCategory] = await tx`
      INSERT INTO categories (server_id, name, position)
      VALUES (${server.id}, 'Misc', 2)
      RETURNING *
    `;

    // 10. Create #moderator-chat in Server Misc (restricted to Moderator+)
    const [moderatorChannel] = await tx`
      INSERT INTO channels (
        server_id, name, type, topic, position, category_id
      )
      VALUES (
        ${server.id},
        'moderator-chat',
        'text',
        'Private channel for moderators and admins',
        0,
        ${serverMiscCategory.id}
      )
      RETURNING *
    `;

    // 10a. Add permission override for moderator-chat: deny @everyone VIEW_CHANNEL
    await tx`
      INSERT INTO channel_permission_overrides (
        channel_id, role_id, text_permissions_allow, text_permissions_deny
      )
      VALUES (
        ${moderatorChannel.id},
        ${everyoneRole.id},
        '0',
        ${1n << 10n}  -- Deny VIEW_CHANNEL (bit 10)
      )
    `;

    // 10b. Add permission override for moderator-chat: allow Moderator VIEW_CHANNEL
    await tx`
      INSERT INTO channel_permission_overrides (
        channel_id, role_id, text_permissions_allow, text_permissions_deny
      )
      VALUES (
        ${moderatorChannel.id},
        ${moderatorRole.id},
        ${1n << 10n},  -- Allow VIEW_CHANNEL (bit 10)
        '0'
      )
    `;

    // 11. Create #announcements channel (announcement type, view-only for @everyone)
    const [announcementsChannel] = await tx`
      INSERT INTO channels (
        server_id, name, type, topic, position, category_id
      )
      VALUES (
        ${server.id},
        'announcements',
        'announcement',
        'Important server announcements',
        1,
        ${serverMiscCategory.id}
      )
      RETURNING *
    `;

    // 12. Create #welcome text channel in Social category (read-only for @everyone)
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
        ${socialCategory.id}
      )
      RETURNING *
    `;

    // 12a. Add permission override for welcome: deny @everyone SEND_MESSAGES
    await tx`
      INSERT INTO channel_permission_overrides (
        channel_id, role_id, text_permissions_allow, text_permissions_deny
      )
      VALUES (
        ${welcomeChannel.id},
        ${everyoneRole.id},
        '0',
        ${1n << 11n}  -- Deny SEND_MESSAGES (bit 11)
      )
    `;

    // 13. Create #general text channel in Social
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
        ${socialCategory.id}
      )
      RETURNING *
    `;

    // 14. Create Lounge voice channel in Social
    const [loungeVoice] = await tx`
      INSERT INTO channels (
        server_id, name, type, position, bitrate, category_id
      )
      VALUES (
        ${server.id},
        'Lounge',
        'voice',
        2,
        64000,
        ${socialCategory.id}
      )
      RETURNING *
    `;

    // 15. Create Music Channel (music/stage type) in Social
    const [musicChannel] = await tx`
      INSERT INTO channels (
        server_id, name, type, position, bitrate, category_id
      )
      VALUES (
        ${server.id},
        'Music Channel',
        'music',
        3,
        128000,
        ${socialCategory.id}
      )
      RETURNING *
    `;

    // 16. Create AFK channel in Misc category
    const [afkChannel] = await tx`
      INSERT INTO channels (
        server_id, name, type, position, bitrate, is_afk_channel, category_id
      )
      VALUES (
        ${server.id},
        'AFK Channel',
        'voice',
        0,
        8000,
        true,
        ${miscCategory.id}
      )
      RETURNING *
    `;

    // 17. Update server with special channel references
    await tx`
      UPDATE servers
      SET welcome_channel_id = ${welcomeChannel.id},
          afk_channel_id = ${afkChannel.id}
      WHERE id = ${server.id}
    `;

    // 18. Add owner as member
    await tx`
      INSERT INTO members (user_id, server_id)
      VALUES (${ownerId}, ${server.id})
    `;

    // 19. Assign Admin role to owner
    await tx`
      INSERT INTO member_roles (member_user_id, member_server_id, role_id)
      VALUES (${ownerId}, ${server.id}, ${adminRole.id})
    `;

    // Return server with channels, categories, and roles
    return {
      ...server,
      welcome_channel_id: welcomeChannel.id,
      afk_channel_id: afkChannel.id,
      channels: [
        moderatorChannel,
        announcementsChannel,
        welcomeChannel,
        generalChannel,
        loungeVoice,
        musicChannel,
        afkChannel,
      ],
      categories: [serverMiscCategory, socialCategory, miscCategory],
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
      io.to(`server:${serverId}`).emit('member.join', {
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
        io.to(`channel:${server.welcome_channel_id}`).emit('message.new', {
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
      io.to(`server:${serverId}`).emit('member.leave', {
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
        io.to(`channel:${server.welcome_channel_id}`).emit('message.new', {
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
