import { sql } from '../lib/db.js';
import {
  ServerPermissions,
  TextPermissions,
  VoicePermissions,
  hasPermission,
  stringToPermission,
  DEFAULT_EVERYONE_PERMISSIONS,
  ALL_PERMISSIONS,
} from '@sgchat/shared';

export interface PermissionSet {
  server: bigint;
  text: bigint;
  voice: bigint;
  isOwner: boolean;
  isTimedOut: boolean;
}

export interface RoleInfo {
  id: string;
  name: string;
  position: number;
  color: string | null;
}

/**
 * Calculate a user's permissions for a server and optionally a specific channel
 *
 * Permission calculation order:
 * 1. Server owner bypass - full permissions
 * 2. Timeout check - if timed out, restrict communication permissions
 * 3. Base @everyone role permissions
 * 4. User's assigned roles (OR operation, ordered by position)
 * 5. Administrator bypass - if has ADMINISTRATOR, full permissions
 * 6. Category overrides (if channel has a category with sync enabled)
 * 7. Channel-specific overrides
 *
 * Override application:
 * - Apply deny first, then allow (deny & ~deny, then | allow)
 * - @everyone overrides first, then role overrides by position, then user overrides last
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

  // Server owner has all permissions and bypasses everything
  if (server.owner_id === userId) {
    return {
      server: ALL_PERMISSIONS.server,
      text: ALL_PERMISSIONS.text,
      voice: ALL_PERMISSIONS.voice,
      isOwner: true,
      isTimedOut: false,
    };
  }

  // Check if user is a member and get timeout status
  const [member] = await sql`
    SELECT *, 
      CASE WHEN timeout_until IS NOT NULL AND timeout_until > NOW() THEN true ELSE false END as is_timed_out
    FROM members 
    WHERE user_id = ${userId} AND server_id = ${serverId}
  `;

  if (!member) {
    throw new Error('User is not a member of this server');
  }

  const isTimedOut = member.is_timed_out;

  // Get @everyone role
  const [everyoneRole] = await sql`
    SELECT * FROM roles WHERE server_id = ${serverId} AND name = '@everyone'
  `;

  if (!everyoneRole) {
    throw new Error('@everyone role not found');
  }

  // Start with @everyone permissions
  let serverPerms = stringToPermission(everyoneRole.server_permissions || '0');
  let textPerms = stringToPermission(everyoneRole.text_permissions || '0');
  let voicePerms = stringToPermission(everyoneRole.voice_permissions || '0');

  // Get user's roles (ordered by position descending for proper hierarchy)
  const userRoles = await sql`
    SELECT r.* FROM roles r
    INNER JOIN member_roles mr ON r.id = mr.role_id
    WHERE mr.member_user_id = ${userId} AND mr.member_server_id = ${serverId}
    ORDER BY r.position DESC
  `;

  // Apply role permissions (OR operation - accumulate permissions)
  for (const role of userRoles) {
    serverPerms |= stringToPermission(role.server_permissions || '0');
    textPerms |= stringToPermission(role.text_permissions || '0');
    voicePerms |= stringToPermission(role.voice_permissions || '0');
  }

  // If user has Administrator permission, grant all permissions
  if (serverPerms & ServerPermissions.ADMINISTRATOR) {
    return {
      server: ALL_PERMISSIONS.server,
      text: ALL_PERMISSIONS.text,
      voice: ALL_PERMISSIONS.voice,
      isOwner: false,
      isTimedOut: false, // Admins bypass timeout
    };
  }

  // If user is timed out, remove communication permissions
  if (isTimedOut) {
    // Remove send messages, add reactions, speak, video, stream
    textPerms &= ~TextPermissions.SEND_MESSAGES;
    textPerms &= ~TextPermissions.SEND_TTS_MESSAGES;
    textPerms &= ~TextPermissions.ADD_REACTIONS;
    textPerms &= ~TextPermissions.CREATE_PUBLIC_THREADS;
    textPerms &= ~TextPermissions.CREATE_PRIVATE_THREADS;
    textPerms &= ~TextPermissions.SEND_MESSAGES_IN_THREADS;
    voicePerms &= ~VoicePermissions.SPEAK;
    voicePerms &= ~VoicePermissions.VIDEO;
    voicePerms &= ~VoicePermissions.STREAM;
    voicePerms &= ~VoicePermissions.USE_SOUNDBOARD;
  }

  // Apply channel-specific overrides if channelId provided
  if (channelId) {
    // Get channel info to check for category
    const [channel] = await sql`
      SELECT id, category_id, sync_permissions_with_category 
      FROM channels 
      WHERE id = ${channelId}
    `;

    if (channel) {
      // Apply category overrides if channel is synced with category
      if (channel.category_id && channel.sync_permissions_with_category !== false) {
        const categoryOverrides = await applyCategoryOverrides(
          channel.category_id,
          everyoneRole.id,
          userRoles,
          userId,
          textPerms,
          voicePerms
        );
        textPerms = categoryOverrides.text;
        voicePerms = categoryOverrides.voice;
      }

      // Apply channel-specific overrides (these take precedence over category)
      const channelOverrides = await applyChannelOverrides(
        channelId,
        everyoneRole.id,
        userRoles,
        userId,
        textPerms,
        voicePerms
      );
      textPerms = channelOverrides.text;
      voicePerms = channelOverrides.voice;
    }
  }

  return {
    server: serverPerms,
    text: textPerms,
    voice: voicePerms,
    isOwner: false,
    isTimedOut,
  };
}

/**
 * Apply category permission overrides
 */
async function applyCategoryOverrides(
  categoryId: string,
  everyoneRoleId: string,
  userRoles: any[],
  userId: string,
  textPerms: bigint,
  voicePerms: bigint
): Promise<{ text: bigint; voice: bigint }> {
  // Get @everyone override for category
  const [everyoneOverride] = await sql`
    SELECT * FROM category_permission_overrides
    WHERE category_id = ${categoryId} AND role_id = ${everyoneRoleId}
  `;

  if (everyoneOverride) {
    textPerms &= ~stringToPermission(everyoneOverride.text_deny || '0');
    textPerms |= stringToPermission(everyoneOverride.text_allow || '0');
    voicePerms &= ~stringToPermission(everyoneOverride.voice_deny || '0');
    voicePerms |= stringToPermission(everyoneOverride.voice_allow || '0');
  }

  // Apply role overrides (in position order, lowest to highest)
  const sortedRoles = [...userRoles].sort((a, b) => a.position - b.position);
  for (const role of sortedRoles) {
    const [roleOverride] = await sql`
      SELECT * FROM category_permission_overrides
      WHERE category_id = ${categoryId} AND role_id = ${role.id}
    `;

    if (roleOverride) {
      textPerms &= ~stringToPermission(roleOverride.text_deny || '0');
      textPerms |= stringToPermission(roleOverride.text_allow || '0');
      voicePerms &= ~stringToPermission(roleOverride.voice_deny || '0');
      voicePerms |= stringToPermission(roleOverride.voice_allow || '0');
    }
  }

  // Apply user-specific override (highest priority)
  const [userOverride] = await sql`
    SELECT * FROM category_permission_overrides
    WHERE category_id = ${categoryId} AND user_id = ${userId}
  `;

  if (userOverride) {
    textPerms &= ~stringToPermission(userOverride.text_deny || '0');
    textPerms |= stringToPermission(userOverride.text_allow || '0');
    voicePerms &= ~stringToPermission(userOverride.voice_deny || '0');
    voicePerms |= stringToPermission(userOverride.voice_allow || '0');
  }

  return { text: textPerms, voice: voicePerms };
}

/**
 * Apply channel permission overrides
 */
async function applyChannelOverrides(
  channelId: string,
  everyoneRoleId: string,
  userRoles: any[],
  userId: string,
  textPerms: bigint,
  voicePerms: bigint
): Promise<{ text: bigint; voice: bigint }> {
  // Get @everyone override for channel
  const [everyoneOverride] = await sql`
    SELECT * FROM channel_permission_overrides
    WHERE channel_id = ${channelId} AND role_id = ${everyoneRoleId}
  `;

  if (everyoneOverride) {
    textPerms &= ~stringToPermission(everyoneOverride.text_deny || '0');
    textPerms |= stringToPermission(everyoneOverride.text_allow || '0');
    voicePerms &= ~stringToPermission(everyoneOverride.voice_deny || '0');
    voicePerms |= stringToPermission(everyoneOverride.voice_allow || '0');
  }

  // Apply role overrides (in position order, lowest to highest)
  const sortedRoles = [...userRoles].sort((a, b) => a.position - b.position);
  for (const role of sortedRoles) {
    const [roleOverride] = await sql`
      SELECT * FROM channel_permission_overrides
      WHERE channel_id = ${channelId} AND role_id = ${role.id}
    `;

    if (roleOverride) {
      textPerms &= ~stringToPermission(roleOverride.text_deny || '0');
      textPerms |= stringToPermission(roleOverride.text_allow || '0');
      voicePerms &= ~stringToPermission(roleOverride.voice_deny || '0');
      voicePerms |= stringToPermission(roleOverride.voice_allow || '0');
    }
  }

  // Apply user-specific override (highest priority)
  const [userOverride] = await sql`
    SELECT * FROM channel_permission_overrides
    WHERE channel_id = ${channelId} AND user_id = ${userId}
  `;

  if (userOverride) {
    textPerms &= ~stringToPermission(userOverride.text_deny || '0');
    textPerms |= stringToPermission(userOverride.text_allow || '0');
    voicePerms &= ~stringToPermission(userOverride.voice_deny || '0');
    voicePerms |= stringToPermission(userOverride.voice_allow || '0');
  }

  return { text: textPerms, voice: voicePerms };
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

  try {
    const perms = await calculatePermissions(userId, channel.server_id, channelId);

    if (channel.type === 'text') {
      return hasPermission(perms.text, TextPermissions.VIEW_CHANNEL);
    } else {
      return hasPermission(perms.voice, VoicePermissions.VIEW_CHANNEL);
    }
  } catch {
    // User is not a member
    return false;
  }
}

/**
 * Get the highest role position for a user in a server
 */
export async function getUserHighestRolePosition(
  userId: string,
  serverId: string
): Promise<number> {
  const [result] = await sql`
    SELECT COALESCE(MAX(r.position), 0) as max_position
    FROM roles r
    INNER JOIN member_roles mr ON r.id = mr.role_id
    WHERE mr.member_user_id = ${userId} AND mr.member_server_id = ${serverId}
  `;

  return result?.max_position || 0;
}

/**
 * Check if a user can manage another user (for kicks, bans, role changes)
 * Returns true if the actor's highest role is above the target's highest role
 */
export async function canManageMember(
  actorId: string,
  targetId: string,
  serverId: string
): Promise<boolean> {
  // Check if actor is server owner
  const [server] = await sql`SELECT owner_id FROM servers WHERE id = ${serverId}`;
  if (server?.owner_id === actorId) return true;
  if (server?.owner_id === targetId) return false; // Can't manage owner

  const actorPosition = await getUserHighestRolePosition(actorId, serverId);
  const targetPosition = await getUserHighestRolePosition(targetId, serverId);

  return actorPosition > targetPosition;
}

/**
 * Check if a user can manage a role (their highest role must be above the target role)
 */
export async function canManageRole(
  userId: string,
  serverId: string,
  roleId: string
): Promise<boolean> {
  // Check if user is server owner
  const [server] = await sql`SELECT owner_id FROM servers WHERE id = ${serverId}`;
  if (server?.owner_id === userId) return true;

  const userPosition = await getUserHighestRolePosition(userId, serverId);
  const [role] = await sql`SELECT position FROM roles WHERE id = ${roleId}`;

  if (!role) return false;

  return userPosition > role.position;
}

/**
 * Get a user's roles in a server
 */
export async function getUserRoles(
  userId: string,
  serverId: string
): Promise<RoleInfo[]> {
  const roles = await sql`
    SELECT r.id, r.name, r.position, r.color
    FROM roles r
    INNER JOIN member_roles mr ON r.id = mr.role_id
    WHERE mr.member_user_id = ${userId} AND mr.member_server_id = ${serverId}
    ORDER BY r.position DESC
  `;

  return roles;
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

/**
 * Timeout a member (prevent them from communicating)
 */
export async function timeoutMember(
  userId: string,
  serverId: string,
  duration: number, // in seconds
  reason?: string
): Promise<void> {
  const timeoutUntil = new Date(Date.now() + duration * 1000);

  await sql`
    UPDATE members
    SET timeout_until = ${timeoutUntil},
        timeout_reason = ${reason || null}
    WHERE user_id = ${userId} AND server_id = ${serverId}
  `;
}

/**
 * Remove timeout from a member
 */
export async function removeTimeout(
  userId: string,
  serverId: string
): Promise<void> {
  await sql`
    UPDATE members
    SET timeout_until = NULL,
        timeout_reason = NULL
    WHERE user_id = ${userId} AND server_id = ${serverId}
  `;
}

/**
 * Check if a member is currently timed out
 */
export async function isTimedOut(
  userId: string,
  serverId: string
): Promise<boolean> {
  const [member] = await sql`
    SELECT timeout_until
    FROM members
    WHERE user_id = ${userId} AND server_id = ${serverId}
  `;

  if (!member || !member.timeout_until) return false;
  return new Date(member.timeout_until) > new Date();
}
