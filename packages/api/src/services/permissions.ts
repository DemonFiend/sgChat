import { sql } from '../lib/db.js';
import {
  ServerPermissions,
  TextPermissions,
  VoicePermissions,
  hasPermission,
  stringToPermission,
  DEFAULT_EVERYONE_PERMISSIONS,
} from '@voxcord/shared';

export interface PermissionSet {
  server: bigint;
  text: bigint;
  voice: bigint;
  isOwner: boolean;
}

/**
 * Calculate a user's permissions for a server and optionally a specific channel
 */
export async function calculatePermissions(
  userId: string,
  serverId: string,
  channelId?: string
): Promise<PermissionSet> {
  // Check if user is server owner
  const [server] = await sql`
    SELECT owner_id FROM servers WHERE id = ${serverId}
  `;

  if (!server) {
    throw new Error('Server not found');
  }

  // Server owner has all permissions
  if (server.owner_id === userId) {
    return {
      server: BigInt(-1), // All bits set
      text: BigInt(-1),
      voice: BigInt(-1),
      isOwner: true,
    };
  }

  // Check if user is a member
  const [member] = await sql`
    SELECT * FROM members WHERE user_id = ${userId} AND server_id = ${serverId}
  `;

  if (!member) {
    throw new Error('User is not a member of this server');
  }

  // Get @everyone role
  const [everyoneRole] = await sql`
    SELECT * FROM roles WHERE server_id = ${serverId} AND name = '@everyone'
  `;

  // Start with @everyone permissions
  let serverPerms = stringToPermission(everyoneRole.server_permissions);
  let textPerms = stringToPermission(everyoneRole.text_permissions);
  let voicePerms = stringToPermission(everyoneRole.voice_permissions);

  // Get user's roles
  const userRoles = await sql`
    SELECT r.* FROM roles r
    INNER JOIN member_roles mr ON r.id = mr.role_id
    WHERE mr.member_user_id = ${userId} AND mr.member_server_id = ${serverId}
    ORDER BY r.position DESC
  `;

  // Apply role permissions (OR operation)
  for (const role of userRoles) {
    serverPerms |= stringToPermission(role.server_permissions);
    textPerms |= stringToPermission(role.text_permissions);
    voicePerms |= stringToPermission(role.voice_permissions);
  }

  // If admin, grant all permissions
  if (serverPerms & ServerPermissions.ADMINISTRATOR) {
    return {
      server: BigInt(-1),
      text: BigInt(-1),
      voice: BigInt(-1),
      isOwner: false,
    };
  }

  // Apply channel-specific overrides if channelId provided
  if (channelId) {
    // Get channel overrides for @everyone
    const [everyoneOverride] = await sql`
      SELECT * FROM channel_permission_overrides
      WHERE channel_id = ${channelId} AND role_id = ${everyoneRole.id}
    `;

    if (everyoneOverride) {
      textPerms &= ~stringToPermission(everyoneOverride.text_deny);
      textPerms |= stringToPermission(everyoneOverride.text_allow);
      voicePerms &= ~stringToPermission(everyoneOverride.voice_deny);
      voicePerms |= stringToPermission(everyoneOverride.voice_allow);
    }

    // Apply role overrides
    for (const role of userRoles) {
      const [roleOverride] = await sql`
        SELECT * FROM channel_permission_overrides
        WHERE channel_id = ${channelId} AND role_id = ${role.id}
      `;

      if (roleOverride) {
        textPerms &= ~stringToPermission(roleOverride.text_deny);
        textPerms |= stringToPermission(roleOverride.text_allow);
        voicePerms &= ~stringToPermission(roleOverride.voice_deny);
        voicePerms |= stringToPermission(roleOverride.voice_allow);
      }
    }

    // Apply user-specific override (highest priority)
    const [userOverride] = await sql`
      SELECT * FROM channel_permission_overrides
      WHERE channel_id = ${channelId} AND user_id = ${userId}
    `;

    if (userOverride) {
      textPerms &= ~stringToPermission(userOverride.text_deny);
      textPerms |= stringToPermission(userOverride.text_allow);
      voicePerms &= ~stringToPermission(userOverride.voice_deny);
      voicePerms |= stringToPermission(userOverride.voice_allow);
    }
  }

  return {
    server: serverPerms,
    text: textPerms,
    voice: voicePerms,
    isOwner: false,
  };
}

/**
 * Check if user can access a channel
 */
export async function canAccessChannel(
  userId: string,
  channelId: string
): Promise<boolean> {
  const [channel] = await sql`SELECT * FROM channels WHERE id = ${channelId}`;
  if (!channel) return false;

  const perms = await calculatePermissions(userId, channel.server_id, channelId);

  if (channel.type === 'text') {
    return hasPermission(perms.text, TextPermissions.VIEW_CHANNEL);
  } else {
    return hasPermission(perms.voice, VoicePermissions.CONNECT);
  }
}

/**
 * Get instance default permissions
 */
export async function getDefaultPermissions() {
  const [settings] = await sql`
    SELECT value FROM instance_settings WHERE key = 'default_everyone_permissions'
  `;

  if (settings) {
    return {
      server: stringToPermission(settings.value.server),
      text: stringToPermission(settings.value.text),
      voice: stringToPermission(settings.value.voice),
    };
  }

  // Fallback to hardcoded defaults
  return DEFAULT_EVERYONE_PERMISSIONS;
}
