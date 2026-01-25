import { sql } from '../lib/db.js';
import { db } from '../lib/db.js';
import { nanoid } from 'nanoid';
import { getDefaultPermissions } from './permissions.js';
import { permissionToString, RoleTemplates } from '@sgchat/shared';

/**
 * Create a new server with default channels and roles
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

    // 3. Create @everyone role
    const [everyoneRole] = await tx`
      INSERT INTO roles (
        server_id, name, position,
        server_permissions, text_permissions, voice_permissions
      )
      VALUES (
        ${server.id},
        '@everyone',
        0,
        ${permissionToString(defaultPerms.server)},
        ${permissionToString(defaultPerms.text)},
        ${permissionToString(defaultPerms.voice)}
      )
      RETURNING *
    `;

    // 4. Create #welcome text channel
    const [welcomeChannel] = await tx`
      INSERT INTO channels (
        server_id, name, type, topic, position
      )
      VALUES (
        ${server.id},
        'welcome',
        'text',
        'Welcome new members! Join and leave messages appear here.',
        0
      )
      RETURNING *
    `;

    // 5. Create General Voice channel
    const [generalVoice] = await tx`
      INSERT INTO channels (
        server_id, name, type, position, bitrate
      )
      VALUES (
        ${server.id},
        'General Voice',
        'voice',
        0,
        64000
      )
      RETURNING *
    `;

    // 6. Create AFK channel
    const [afkChannel] = await tx`
      INSERT INTO channels (
        server_id, name, type, position, bitrate, is_afk_channel
      )
      VALUES (
        ${server.id},
        'AFK',
        'voice',
        999,
        8000,
        true
      )
      RETURNING *
    `;

    // 7. Update server with special channel references
    await tx`
      UPDATE servers
      SET welcome_channel_id = ${welcomeChannel.id},
          afk_channel_id = ${afkChannel.id}
      WHERE id = ${server.id}
    `;

    // 8. Add owner as member
    await tx`
      INSERT INTO members (user_id, server_id)
      VALUES (${ownerId}, ${server.id})
    `;

    // Return server with channels
    return {
      ...server,
      welcome_channel_id: welcomeChannel.id,
      afk_channel_id: afkChannel.id,
      channels: [welcomeChannel, generalVoice, afkChannel],
      roles: [everyoneRole],
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
        io.to(`channel:${server.welcome_channel_id}`).emit('message:new', {
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
        io.to(`channel:${server.welcome_channel_id}`).emit('message:new', {
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
  templateName: keyof typeof RoleTemplates
) {
  const template = RoleTemplates[templateName];
  if (!template) {
    throw new Error('Invalid template name');
  }

  return db.roles.create({
    server_id: serverId,
    name: template.name,
    color: template.color,
    server_permissions: permissionToString(template.server),
    text_permissions: permissionToString(template.text),
    voice_permissions: permissionToString(template.voice),
  });
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
