/**
 * Permission system for sgChat
 * Uses bigint bitmasks for efficient permission checking
 */

// Server-wide permissions
export const ServerPermissions = {
  ADMINISTRATOR: 1n << 0n, // Bypasses all permission checks
  MANAGE_SERVER: 1n << 1n,
  MANAGE_CHANNELS: 1n << 2n,
  MANAGE_ROLES: 1n << 3n,
  KICK_MEMBERS: 1n << 4n,
  BAN_MEMBERS: 1n << 5n,
  CREATE_INVITES: 1n << 6n,
  CHANGE_NICKNAME: 1n << 7n,
  MANAGE_NICKNAMES: 1n << 8n,
  VIEW_AUDIT_LOG: 1n << 9n,
} as const;

// Text channel permissions
export const TextPermissions = {
  VIEW_CHANNEL: 1n << 0n,
  SEND_MESSAGES: 1n << 1n,
  EMBED_LINKS: 1n << 2n,
  ATTACH_FILES: 1n << 3n,
  ADD_REACTIONS: 1n << 4n,
  MENTION_EVERYONE: 1n << 5n,
  MANAGE_MESSAGES: 1n << 6n,
  READ_MESSAGE_HISTORY: 1n << 7n,
} as const;

// Voice channel permissions
export const VoicePermissions = {
  // Basic
  CONNECT: 1n << 0n,
  SPEAK: 1n << 1n,
  VIDEO: 1n << 2n,
  STREAM: 1n << 3n,
  // Moderation
  MUTE_MEMBERS: 1n << 4n,
  DEAFEN_MEMBERS: 1n << 5n,
  MOVE_MEMBERS: 1n << 6n,
  DISCONNECT_MEMBERS: 1n << 7n,
  // Advanced
  PRIORITY_SPEAKER: 1n << 8n,
  USE_VOICE_ACTIVITY: 1n << 9n,
} as const;

/**
 * Check if user has specific permission
 * @param userPerms User's calculated permissions
 * @param required Required permission to check
 * @returns True if user has permission
 */
export function hasPermission(userPerms: bigint, required: bigint): boolean {
  // Admin bypasses all checks
  if (userPerms & ServerPermissions.ADMINISTRATOR) return true;
  return (userPerms & required) === required;
}

/**
 * Check if user has any of the specified permissions
 */
export function hasAnyPermission(userPerms: bigint, ...permissions: bigint[]): boolean {
  if (userPerms & ServerPermissions.ADMINISTRATOR) return true;
  return permissions.some((perm) => (userPerms & perm) === perm);
}

/**
 * Default @everyone role permissions (configurable per instance)
 */
export const DEFAULT_EVERYONE_PERMISSIONS = {
  server: ServerPermissions.CREATE_INVITES | ServerPermissions.CHANGE_NICKNAME,
  text:
    TextPermissions.VIEW_CHANNEL |
    TextPermissions.SEND_MESSAGES |
    TextPermissions.EMBED_LINKS |
    TextPermissions.ATTACH_FILES |
    TextPermissions.ADD_REACTIONS |
    TextPermissions.READ_MESSAGE_HISTORY,
  voice:
    VoicePermissions.CONNECT | VoicePermissions.SPEAK | VoicePermissions.USE_VOICE_ACTIVITY,
} as const;

/**
 * Role templates for quick server setup
 */
export const RoleTemplates = {
  ADMIN: {
    name: 'Admin',
    color: '#e74c3c',
    server: ServerPermissions.ADMINISTRATOR,
    text: BigInt('0xFFFFFFFFFFFFFFFF'), // All permissions
    voice: BigInt('0xFFFFFFFFFFFFFFFF'),
    description: 'Full server access. Use sparingly.',
  },
  MODERATOR: {
    name: 'Moderator',
    color: '#3498db',
    server:
      ServerPermissions.KICK_MEMBERS |
      ServerPermissions.BAN_MEMBERS |
      ServerPermissions.MANAGE_NICKNAMES,
    text:
      TextPermissions.VIEW_CHANNEL |
      TextPermissions.SEND_MESSAGES |
      TextPermissions.EMBED_LINKS |
      TextPermissions.ATTACH_FILES |
      TextPermissions.ADD_REACTIONS |
      TextPermissions.MENTION_EVERYONE |
      TextPermissions.MANAGE_MESSAGES |
      TextPermissions.READ_MESSAGE_HISTORY,
    voice:
      VoicePermissions.CONNECT |
      VoicePermissions.SPEAK |
      VoicePermissions.VIDEO |
      VoicePermissions.STREAM |
      VoicePermissions.MUTE_MEMBERS |
      VoicePermissions.DEAFEN_MEMBERS |
      VoicePermissions.MOVE_MEMBERS |
      VoicePermissions.DISCONNECT_MEMBERS |
      VoicePermissions.USE_VOICE_ACTIVITY,
    description: 'Can moderate members and messages.',
  },
  MEMBER: {
    name: 'Member',
    color: '#2ecc71',
    server: ServerPermissions.CREATE_INVITES | ServerPermissions.CHANGE_NICKNAME,
    text:
      TextPermissions.VIEW_CHANNEL |
      TextPermissions.SEND_MESSAGES |
      TextPermissions.EMBED_LINKS |
      TextPermissions.ATTACH_FILES |
      TextPermissions.ADD_REACTIONS |
      TextPermissions.READ_MESSAGE_HISTORY,
    voice:
      VoicePermissions.CONNECT |
      VoicePermissions.SPEAK |
      VoicePermissions.VIDEO |
      VoicePermissions.STREAM |
      VoicePermissions.USE_VOICE_ACTIVITY,
    description: 'Standard member with voice/video access.',
  },
  MUTED: {
    name: 'Muted',
    color: '#95a5a6',
    server: 0n,
    text: TextPermissions.VIEW_CHANNEL | TextPermissions.READ_MESSAGE_HISTORY,
    voice: VoicePermissions.CONNECT, // Can listen but not speak
    description: 'Restricted. Can read/listen only.',
  },
} as const;

/**
 * Convert permission bigint to string for storage
 */
export function permissionToString(perm: bigint): string {
  return perm.toString();
}

/**
 * Convert permission string back to bigint
 */
export function stringToPermission(str: string): bigint {
  return BigInt(str);
}

/**
 * Named permissions object for client consumption
 */
export interface NamedPermissions {
  // Server permissions
  administrator: boolean;
  manage_server: boolean;
  manage_channels: boolean;
  manage_roles: boolean;
  kick_members: boolean;
  ban_members: boolean;
  create_invites: boolean;
  change_nickname: boolean;
  manage_nicknames: boolean;
  view_audit_log: boolean;
  // Text permissions
  view_channel: boolean;
  send_messages: boolean;
  embed_links: boolean;
  attach_files: boolean;
  add_reactions: boolean;
  mention_everyone: boolean;
  manage_messages: boolean;
  read_message_history: boolean;
  // Voice permissions
  connect: boolean;
  speak: boolean;
  video: boolean;
  stream: boolean;
  mute_members: boolean;
  deafen_members: boolean;
  move_members: boolean;
  disconnect_members: boolean;
  priority_speaker: boolean;
  use_voice_activity: boolean;
}

/**
 * Convert bitmask permissions to named boolean object
 * @param serverPerms Server permission bitmask (bigint or string)
 * @param textPerms Text permission bitmask (bigint or string)
 * @param voicePerms Voice permission bitmask (bigint or string)
 * @returns Named permissions object with boolean values
 */
export function toNamedPermissions(
  serverPerms: bigint | string | number,
  textPerms: bigint | string | number,
  voicePerms: bigint | string | number
): NamedPermissions {
  const server = typeof serverPerms === 'bigint' ? serverPerms : BigInt(serverPerms || 0);
  const text = typeof textPerms === 'bigint' ? textPerms : BigInt(textPerms || 0);
  const voice = typeof voicePerms === 'bigint' ? voicePerms : BigInt(voicePerms || 0);

  const isAdmin = (server & ServerPermissions.ADMINISTRATOR) !== 0n;

  return {
    // Server permissions (admin bypasses all)
    administrator: isAdmin,
    manage_server: isAdmin || (server & ServerPermissions.MANAGE_SERVER) !== 0n,
    manage_channels: isAdmin || (server & ServerPermissions.MANAGE_CHANNELS) !== 0n,
    manage_roles: isAdmin || (server & ServerPermissions.MANAGE_ROLES) !== 0n,
    kick_members: isAdmin || (server & ServerPermissions.KICK_MEMBERS) !== 0n,
    ban_members: isAdmin || (server & ServerPermissions.BAN_MEMBERS) !== 0n,
    create_invites: isAdmin || (server & ServerPermissions.CREATE_INVITES) !== 0n,
    change_nickname: isAdmin || (server & ServerPermissions.CHANGE_NICKNAME) !== 0n,
    manage_nicknames: isAdmin || (server & ServerPermissions.MANAGE_NICKNAMES) !== 0n,
    view_audit_log: isAdmin || (server & ServerPermissions.VIEW_AUDIT_LOG) !== 0n,
    // Text permissions
    view_channel: isAdmin || (text & TextPermissions.VIEW_CHANNEL) !== 0n,
    send_messages: isAdmin || (text & TextPermissions.SEND_MESSAGES) !== 0n,
    embed_links: isAdmin || (text & TextPermissions.EMBED_LINKS) !== 0n,
    attach_files: isAdmin || (text & TextPermissions.ATTACH_FILES) !== 0n,
    add_reactions: isAdmin || (text & TextPermissions.ADD_REACTIONS) !== 0n,
    mention_everyone: isAdmin || (text & TextPermissions.MENTION_EVERYONE) !== 0n,
    manage_messages: isAdmin || (text & TextPermissions.MANAGE_MESSAGES) !== 0n,
    read_message_history: isAdmin || (text & TextPermissions.READ_MESSAGE_HISTORY) !== 0n,
    // Voice permissions
    connect: isAdmin || (voice & VoicePermissions.CONNECT) !== 0n,
    speak: isAdmin || (voice & VoicePermissions.SPEAK) !== 0n,
    video: isAdmin || (voice & VoicePermissions.VIDEO) !== 0n,
    stream: isAdmin || (voice & VoicePermissions.STREAM) !== 0n,
    mute_members: isAdmin || (voice & VoicePermissions.MUTE_MEMBERS) !== 0n,
    deafen_members: isAdmin || (voice & VoicePermissions.DEAFEN_MEMBERS) !== 0n,
    move_members: isAdmin || (voice & VoicePermissions.MOVE_MEMBERS) !== 0n,
    disconnect_members: isAdmin || (voice & VoicePermissions.DISCONNECT_MEMBERS) !== 0n,
    priority_speaker: isAdmin || (voice & VoicePermissions.PRIORITY_SPEAKER) !== 0n,
    use_voice_activity: isAdmin || (voice & VoicePermissions.USE_VOICE_ACTIVITY) !== 0n,
  };
}
