/**
 * Permission system for sgChat
 * Uses bigint bitmasks for efficient permission checking
 *
 * Permission Categories:
 * - ServerPermissions: Guild-wide administrative permissions
 * - TextPermissions: Text channel specific permissions
 * - VoicePermissions: Voice channel specific permissions
 *
 * Each category supports up to 64 individual permissions via bigint bitmasks.
 * Permissions are stored as stringified bigints in the database.
 */

// ============================================================
// SERVER-WIDE PERMISSIONS (Guild-Level)
// ============================================================
export const ServerPermissions = {
  // Core administrative
  ADMINISTRATOR: 1n << 0n, // Bypasses ALL permission checks - use sparingly
  MANAGE_SERVER: 1n << 1n, // Edit server settings, name, icon, etc.
  MANAGE_CHANNELS: 1n << 2n, // Create, edit, delete channels
  MANAGE_ROLES: 1n << 3n, // Create, edit, delete roles (below own highest role)
  MANAGE_CATEGORIES: 1n << 4n, // Create, edit, delete categories

  // Moderation
  KICK_MEMBERS: 1n << 5n, // Remove members from the server
  BAN_MEMBERS: 1n << 6n, // Permanently ban members
  TIMEOUT_MEMBERS: 1n << 7n, // Temporarily mute members (communication timeout)
  MANAGE_NICKNAMES: 1n << 8n, // Change other members' nicknames

  // Invites and access
  CREATE_INVITES: 1n << 9n, // Create invite links
  MANAGE_INVITES: 1n << 10n, // View and delete invites

  // Self permissions
  CHANGE_NICKNAME: 1n << 11n, // Change own nickname

  // Audit and moderation tools
  VIEW_AUDIT_LOG: 1n << 12n, // View server audit log
  VIEW_SERVER_INSIGHTS: 1n << 13n, // View server analytics

  // Emoji and expression management
  MANAGE_EMOJIS: 1n << 14n, // Create, edit, delete custom emojis
  MANAGE_STICKERS: 1n << 15n, // Create, edit, delete stickers
  MANAGE_EXPRESSIONS: 1n << 16n, // Manage all expressions (emojis, stickers, soundboard)

  // Webhooks
  MANAGE_WEBHOOKS: 1n << 17n, // Create, edit, delete webhooks

  // Events
  CREATE_EVENTS: 1n << 18n, // Create server events
  MANAGE_EVENTS: 1n << 19n, // Edit and delete server events

  // Threads (server-wide)
  MANAGE_THREADS: 1n << 20n, // Manage all threads in the server
  CREATE_PUBLIC_THREADS: 1n << 21n, // Create public threads
  CREATE_PRIVATE_THREADS: 1n << 22n, // Create private threads

  // Advanced
  VIEW_SERVER_MEMBERS: 1n << 23n, // View member list (if restricted)
  MODERATE_MEMBERS: 1n << 24n, // Access to auto-moderation and member screening

  // Reserved for future use (25-63)
} as const;

// ============================================================
// TEXT CHANNEL PERMISSIONS
// ============================================================
export const TextPermissions = {
  // Visibility
  VIEW_CHANNEL: 1n << 0n, // Can see the channel in the channel list

  // Basic messaging
  SEND_MESSAGES: 1n << 1n, // Send messages in the channel
  SEND_TTS_MESSAGES: 1n << 2n, // Send text-to-speech messages
  READ_MESSAGE_HISTORY: 1n << 3n, // Read past messages

  // Rich content
  EMBED_LINKS: 1n << 4n, // Post links with automatic embeds
  ATTACH_FILES: 1n << 5n, // Upload files and images
  USE_EXTERNAL_EMOJIS: 1n << 6n, // Use emojis from other servers
  USE_EXTERNAL_STICKERS: 1n << 7n, // Use stickers from other servers

  // Reactions
  ADD_REACTIONS: 1n << 8n, // Add reactions to messages

  // Mentions
  MENTION_EVERYONE: 1n << 9n, // Use @everyone and @here
  MENTION_ROLES: 1n << 10n, // Mention any role (including non-mentionable)

  // Message management
  MANAGE_MESSAGES: 1n << 11n, // Delete/pin other users' messages
  DELETE_OWN_MESSAGES: 1n << 12n, // Delete own messages (usually always allowed)
  EDIT_OWN_MESSAGES: 1n << 13n, // Edit own messages (usually always allowed)

  // Threads
  CREATE_PUBLIC_THREADS: 1n << 14n, // Create public threads
  CREATE_PRIVATE_THREADS: 1n << 15n, // Create private threads
  SEND_MESSAGES_IN_THREADS: 1n << 16n, // Send messages in threads
  MANAGE_THREADS: 1n << 17n, // Archive, delete threads

  // Application commands
  USE_APPLICATION_COMMANDS: 1n << 18n, // Use slash commands and bot commands

  // Webhooks (channel-specific)
  MANAGE_WEBHOOKS: 1n << 19n, // Manage webhooks in this channel

  // Slowmode bypass
  BYPASS_SLOWMODE: 1n << 20n, // Ignore slowmode restrictions

  // Reserved for future use (21-63)
} as const;

// ============================================================
// VOICE CHANNEL PERMISSIONS
// ============================================================
export const VoicePermissions = {
  // Basic access
  CONNECT: 1n << 0n, // Join the voice channel
  VIEW_CHANNEL: 1n << 1n, // See the voice channel (separate from connect)

  // Communication
  SPEAK: 1n << 2n, // Transmit audio
  VIDEO: 1n << 3n, // Share video/camera
  STREAM: 1n << 4n, // Screen share/streaming

  // Voice activity
  USE_VOICE_ACTIVITY: 1n << 5n, // Use voice activity detection (vs push-to-talk only)
  PRIORITY_SPEAKER: 1n << 6n, // Lower others' volume when speaking

  // Soundboard
  USE_SOUNDBOARD: 1n << 7n, // Play soundboard sounds
  USE_EXTERNAL_SOUNDS: 1n << 8n, // Use sounds from other servers

  // Moderation
  MUTE_MEMBERS: 1n << 9n, // Server mute other members
  DEAFEN_MEMBERS: 1n << 10n, // Server deafen other members
  MOVE_MEMBERS: 1n << 11n, // Move members to other voice channels
  DISCONNECT_MEMBERS: 1n << 12n, // Disconnect members from voice

  // Stage channels (if implemented)
  REQUEST_TO_SPEAK: 1n << 13n, // Request to speak in stage channels
  MANAGE_STAGE: 1n << 14n, // Manage stage speakers

  // Channel management
  MANAGE_VOICE_CHANNEL: 1n << 15n, // Edit voice channel settings (bitrate, limit, etc.)
  SET_VOICE_STATUS: 1n << 16n, // Set a custom voice channel status

  // Reserved for future use (17-63)
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
 * Check if user has all of the specified permissions
 */
export function hasAllPermissions(userPerms: bigint, ...permissions: bigint[]): boolean {
  if (userPerms & ServerPermissions.ADMINISTRATOR) return true;
  return permissions.every((perm) => (userPerms & perm) === perm);
}

/**
 * Combine multiple permissions into a single bitmask
 */
export function combinePermissions(...permissions: bigint[]): bigint {
  return permissions.reduce((acc, perm) => acc | perm, 0n);
}

/**
 * Remove permissions from a bitmask
 */
export function removePermissions(base: bigint, ...toRemove: bigint[]): bigint {
  return toRemove.reduce((acc, perm) => acc & ~perm, base);
}

/**
 * Get list of permission names from a bitmask
 */
export function getPermissionNames(
  perms: bigint,
  category: 'server' | 'text' | 'voice'
): string[] {
  const names: string[] = [];
  const permSet =
    category === 'server'
      ? ServerPermissions
      : category === 'text'
        ? TextPermissions
        : VoicePermissions;

  for (const [name, value] of Object.entries(permSet)) {
    if ((perms & value) === value) {
      names.push(name);
    }
  }
  return names;
}

/**
 * Default @everyone role permissions (configurable per instance)
 */
export const DEFAULT_EVERYONE_PERMISSIONS = {
  server:
    ServerPermissions.CREATE_INVITES |
    ServerPermissions.CHANGE_NICKNAME |
    ServerPermissions.VIEW_SERVER_MEMBERS,
  text:
    TextPermissions.VIEW_CHANNEL |
    TextPermissions.SEND_MESSAGES |
    TextPermissions.READ_MESSAGE_HISTORY |
    TextPermissions.EMBED_LINKS |
    TextPermissions.ATTACH_FILES |
    TextPermissions.ADD_REACTIONS |
    TextPermissions.USE_EXTERNAL_EMOJIS |
    TextPermissions.DELETE_OWN_MESSAGES |
    TextPermissions.EDIT_OWN_MESSAGES |
    TextPermissions.USE_APPLICATION_COMMANDS,
  voice:
    VoicePermissions.CONNECT |
    VoicePermissions.VIEW_CHANNEL |
    VoicePermissions.SPEAK |
    VoicePermissions.VIDEO |
    VoicePermissions.STREAM |
    VoicePermissions.USE_VOICE_ACTIVITY |
    VoicePermissions.USE_SOUNDBOARD,
} as const;

/**
 * All permissions combined - used for administrator/owner
 */
export const ALL_PERMISSIONS = {
  server: BigInt('0xFFFFFFFFFFFFFFFF'),
  text: BigInt('0xFFFFFFFFFFFFFFFF'),
  voice: BigInt('0xFFFFFFFFFFFFFFFF'),
} as const;

/**
 * Role templates for quick server setup
 */
export const RoleTemplates = {
  ADMIN: {
    name: 'Admin',
    color: '#e74c3c',
    server: ServerPermissions.ADMINISTRATOR,
    text: ALL_PERMISSIONS.text,
    voice: ALL_PERMISSIONS.voice,
    hoist: true,
    mentionable: false,
    description: 'Full server access. Use sparingly.',
  },
  MODERATOR: {
    name: 'Moderator',
    color: '#3498db',
    server:
      ServerPermissions.KICK_MEMBERS |
      ServerPermissions.BAN_MEMBERS |
      ServerPermissions.TIMEOUT_MEMBERS |
      ServerPermissions.MANAGE_NICKNAMES |
      ServerPermissions.MANAGE_INVITES |
      ServerPermissions.VIEW_AUDIT_LOG |
      ServerPermissions.MANAGE_THREADS |
      ServerPermissions.MODERATE_MEMBERS,
    text:
      TextPermissions.VIEW_CHANNEL |
      TextPermissions.SEND_MESSAGES |
      TextPermissions.READ_MESSAGE_HISTORY |
      TextPermissions.EMBED_LINKS |
      TextPermissions.ATTACH_FILES |
      TextPermissions.ADD_REACTIONS |
      TextPermissions.USE_EXTERNAL_EMOJIS |
      TextPermissions.USE_EXTERNAL_STICKERS |
      TextPermissions.MENTION_EVERYONE |
      TextPermissions.MENTION_ROLES |
      TextPermissions.MANAGE_MESSAGES |
      TextPermissions.DELETE_OWN_MESSAGES |
      TextPermissions.EDIT_OWN_MESSAGES |
      TextPermissions.MANAGE_THREADS |
      TextPermissions.USE_APPLICATION_COMMANDS |
      TextPermissions.BYPASS_SLOWMODE,
    voice:
      VoicePermissions.CONNECT |
      VoicePermissions.VIEW_CHANNEL |
      VoicePermissions.SPEAK |
      VoicePermissions.VIDEO |
      VoicePermissions.STREAM |
      VoicePermissions.USE_VOICE_ACTIVITY |
      VoicePermissions.PRIORITY_SPEAKER |
      VoicePermissions.USE_SOUNDBOARD |
      VoicePermissions.MUTE_MEMBERS |
      VoicePermissions.DEAFEN_MEMBERS |
      VoicePermissions.MOVE_MEMBERS |
      VoicePermissions.DISCONNECT_MEMBERS,
    hoist: true,
    mentionable: true,
    description: 'Can moderate members and messages.',
  },
  MEMBER: {
    name: 'Member',
    color: '#2ecc71',
    server:
      ServerPermissions.CREATE_INVITES |
      ServerPermissions.CHANGE_NICKNAME |
      ServerPermissions.CREATE_PUBLIC_THREADS,
    text:
      TextPermissions.VIEW_CHANNEL |
      TextPermissions.SEND_MESSAGES |
      TextPermissions.READ_MESSAGE_HISTORY |
      TextPermissions.EMBED_LINKS |
      TextPermissions.ATTACH_FILES |
      TextPermissions.ADD_REACTIONS |
      TextPermissions.USE_EXTERNAL_EMOJIS |
      TextPermissions.DELETE_OWN_MESSAGES |
      TextPermissions.EDIT_OWN_MESSAGES |
      TextPermissions.CREATE_PUBLIC_THREADS |
      TextPermissions.SEND_MESSAGES_IN_THREADS |
      TextPermissions.USE_APPLICATION_COMMANDS,
    voice:
      VoicePermissions.CONNECT |
      VoicePermissions.VIEW_CHANNEL |
      VoicePermissions.SPEAK |
      VoicePermissions.VIDEO |
      VoicePermissions.STREAM |
      VoicePermissions.USE_VOICE_ACTIVITY |
      VoicePermissions.USE_SOUNDBOARD,
    hoist: false,
    mentionable: false,
    description: 'Standard member with voice/video access.',
  },
  MUTED: {
    name: 'Muted',
    color: '#95a5a6',
    server: 0n,
    text: TextPermissions.VIEW_CHANNEL | TextPermissions.READ_MESSAGE_HISTORY,
    voice: VoicePermissions.CONNECT | VoicePermissions.VIEW_CHANNEL, // Can listen but not speak
    hoist: false,
    mentionable: false,
    description: 'Restricted. Can read/listen only.',
  },
  GUEST: {
    name: 'Guest',
    color: '#7f8c8d',
    server: ServerPermissions.VIEW_SERVER_MEMBERS,
    text:
      TextPermissions.VIEW_CHANNEL |
      TextPermissions.SEND_MESSAGES |
      TextPermissions.READ_MESSAGE_HISTORY |
      TextPermissions.ADD_REACTIONS,
    voice:
      VoicePermissions.CONNECT |
      VoicePermissions.VIEW_CHANNEL |
      VoicePermissions.SPEAK |
      VoicePermissions.USE_VOICE_ACTIVITY,
    hoist: false,
    mentionable: false,
    description: 'Limited access for new or unverified members.',
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
  manage_categories: boolean;
  kick_members: boolean;
  ban_members: boolean;
  timeout_members: boolean;
  manage_nicknames: boolean;
  create_invites: boolean;
  manage_invites: boolean;
  change_nickname: boolean;
  view_audit_log: boolean;
  view_server_insights: boolean;
  manage_emojis: boolean;
  manage_stickers: boolean;
  manage_expressions: boolean;
  manage_webhooks: boolean;
  create_events: boolean;
  manage_events: boolean;
  manage_threads: boolean;
  create_public_threads: boolean;
  create_private_threads: boolean;
  view_server_members: boolean;
  moderate_members: boolean;

  // Text permissions
  view_channel: boolean;
  send_messages: boolean;
  send_tts_messages: boolean;
  read_message_history: boolean;
  embed_links: boolean;
  attach_files: boolean;
  use_external_emojis: boolean;
  use_external_stickers: boolean;
  add_reactions: boolean;
  mention_everyone: boolean;
  mention_roles: boolean;
  manage_messages: boolean;
  delete_own_messages: boolean;
  edit_own_messages: boolean;
  create_public_threads_text: boolean;
  create_private_threads_text: boolean;
  send_messages_in_threads: boolean;
  manage_threads_text: boolean;
  use_application_commands: boolean;
  manage_webhooks_text: boolean;
  bypass_slowmode: boolean;

  // Voice permissions
  connect: boolean;
  view_voice_channel: boolean;
  speak: boolean;
  video: boolean;
  stream: boolean;
  use_voice_activity: boolean;
  priority_speaker: boolean;
  use_soundboard: boolean;
  use_external_sounds: boolean;
  mute_members: boolean;
  deafen_members: boolean;
  move_members: boolean;
  disconnect_members: boolean;
  request_to_speak: boolean;
  manage_stage: boolean;
  manage_voice_channel: boolean;
  set_voice_status: boolean;
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
    manage_categories: isAdmin || (server & ServerPermissions.MANAGE_CATEGORIES) !== 0n,
    kick_members: isAdmin || (server & ServerPermissions.KICK_MEMBERS) !== 0n,
    ban_members: isAdmin || (server & ServerPermissions.BAN_MEMBERS) !== 0n,
    timeout_members: isAdmin || (server & ServerPermissions.TIMEOUT_MEMBERS) !== 0n,
    manage_nicknames: isAdmin || (server & ServerPermissions.MANAGE_NICKNAMES) !== 0n,
    create_invites: isAdmin || (server & ServerPermissions.CREATE_INVITES) !== 0n,
    manage_invites: isAdmin || (server & ServerPermissions.MANAGE_INVITES) !== 0n,
    change_nickname: isAdmin || (server & ServerPermissions.CHANGE_NICKNAME) !== 0n,
    view_audit_log: isAdmin || (server & ServerPermissions.VIEW_AUDIT_LOG) !== 0n,
    view_server_insights: isAdmin || (server & ServerPermissions.VIEW_SERVER_INSIGHTS) !== 0n,
    manage_emojis: isAdmin || (server & ServerPermissions.MANAGE_EMOJIS) !== 0n,
    manage_stickers: isAdmin || (server & ServerPermissions.MANAGE_STICKERS) !== 0n,
    manage_expressions: isAdmin || (server & ServerPermissions.MANAGE_EXPRESSIONS) !== 0n,
    manage_webhooks: isAdmin || (server & ServerPermissions.MANAGE_WEBHOOKS) !== 0n,
    create_events: isAdmin || (server & ServerPermissions.CREATE_EVENTS) !== 0n,
    manage_events: isAdmin || (server & ServerPermissions.MANAGE_EVENTS) !== 0n,
    manage_threads: isAdmin || (server & ServerPermissions.MANAGE_THREADS) !== 0n,
    create_public_threads: isAdmin || (server & ServerPermissions.CREATE_PUBLIC_THREADS) !== 0n,
    create_private_threads: isAdmin || (server & ServerPermissions.CREATE_PRIVATE_THREADS) !== 0n,
    view_server_members: isAdmin || (server & ServerPermissions.VIEW_SERVER_MEMBERS) !== 0n,
    moderate_members: isAdmin || (server & ServerPermissions.MODERATE_MEMBERS) !== 0n,

    // Text permissions
    view_channel: isAdmin || (text & TextPermissions.VIEW_CHANNEL) !== 0n,
    send_messages: isAdmin || (text & TextPermissions.SEND_MESSAGES) !== 0n,
    send_tts_messages: isAdmin || (text & TextPermissions.SEND_TTS_MESSAGES) !== 0n,
    read_message_history: isAdmin || (text & TextPermissions.READ_MESSAGE_HISTORY) !== 0n,
    embed_links: isAdmin || (text & TextPermissions.EMBED_LINKS) !== 0n,
    attach_files: isAdmin || (text & TextPermissions.ATTACH_FILES) !== 0n,
    use_external_emojis: isAdmin || (text & TextPermissions.USE_EXTERNAL_EMOJIS) !== 0n,
    use_external_stickers: isAdmin || (text & TextPermissions.USE_EXTERNAL_STICKERS) !== 0n,
    add_reactions: isAdmin || (text & TextPermissions.ADD_REACTIONS) !== 0n,
    mention_everyone: isAdmin || (text & TextPermissions.MENTION_EVERYONE) !== 0n,
    mention_roles: isAdmin || (text & TextPermissions.MENTION_ROLES) !== 0n,
    manage_messages: isAdmin || (text & TextPermissions.MANAGE_MESSAGES) !== 0n,
    delete_own_messages: isAdmin || (text & TextPermissions.DELETE_OWN_MESSAGES) !== 0n,
    edit_own_messages: isAdmin || (text & TextPermissions.EDIT_OWN_MESSAGES) !== 0n,
    create_public_threads_text: isAdmin || (text & TextPermissions.CREATE_PUBLIC_THREADS) !== 0n,
    create_private_threads_text: isAdmin || (text & TextPermissions.CREATE_PRIVATE_THREADS) !== 0n,
    send_messages_in_threads: isAdmin || (text & TextPermissions.SEND_MESSAGES_IN_THREADS) !== 0n,
    manage_threads_text: isAdmin || (text & TextPermissions.MANAGE_THREADS) !== 0n,
    use_application_commands: isAdmin || (text & TextPermissions.USE_APPLICATION_COMMANDS) !== 0n,
    manage_webhooks_text: isAdmin || (text & TextPermissions.MANAGE_WEBHOOKS) !== 0n,
    bypass_slowmode: isAdmin || (text & TextPermissions.BYPASS_SLOWMODE) !== 0n,

    // Voice permissions
    connect: isAdmin || (voice & VoicePermissions.CONNECT) !== 0n,
    view_voice_channel: isAdmin || (voice & VoicePermissions.VIEW_CHANNEL) !== 0n,
    speak: isAdmin || (voice & VoicePermissions.SPEAK) !== 0n,
    video: isAdmin || (voice & VoicePermissions.VIDEO) !== 0n,
    stream: isAdmin || (voice & VoicePermissions.STREAM) !== 0n,
    use_voice_activity: isAdmin || (voice & VoicePermissions.USE_VOICE_ACTIVITY) !== 0n,
    priority_speaker: isAdmin || (voice & VoicePermissions.PRIORITY_SPEAKER) !== 0n,
    use_soundboard: isAdmin || (voice & VoicePermissions.USE_SOUNDBOARD) !== 0n,
    use_external_sounds: isAdmin || (voice & VoicePermissions.USE_EXTERNAL_SOUNDS) !== 0n,
    mute_members: isAdmin || (voice & VoicePermissions.MUTE_MEMBERS) !== 0n,
    deafen_members: isAdmin || (voice & VoicePermissions.DEAFEN_MEMBERS) !== 0n,
    move_members: isAdmin || (voice & VoicePermissions.MOVE_MEMBERS) !== 0n,
    disconnect_members: isAdmin || (voice & VoicePermissions.DISCONNECT_MEMBERS) !== 0n,
    request_to_speak: isAdmin || (voice & VoicePermissions.REQUEST_TO_SPEAK) !== 0n,
    manage_stage: isAdmin || (voice & VoicePermissions.MANAGE_STAGE) !== 0n,
    manage_voice_channel: isAdmin || (voice & VoicePermissions.MANAGE_VOICE_CHANNEL) !== 0n,
    set_voice_status: isAdmin || (voice & VoicePermissions.SET_VOICE_STATUS) !== 0n,
  };
}

/**
 * Permission metadata for UI display
 */
export interface PermissionMetadata {
  name: string;
  description: string;
  category: 'general' | 'membership' | 'text' | 'voice' | 'advanced';
  dangerous?: boolean;
}

/**
 * Server permission metadata for UI
 */
export const ServerPermissionMetadata: Record<keyof typeof ServerPermissions, PermissionMetadata> =
  {
    ADMINISTRATOR: {
      name: 'Administrator',
      description: 'Grants all permissions and bypasses all permission checks',
      category: 'general',
      dangerous: true,
    },
    MANAGE_SERVER: {
      name: 'Manage Server',
      description: 'Edit server settings, name, icon, and other server properties',
      category: 'general',
    },
    MANAGE_CHANNELS: {
      name: 'Manage Channels',
      description: 'Create, edit, and delete channels',
      category: 'general',
    },
    MANAGE_ROLES: {
      name: 'Manage Roles',
      description: 'Create, edit, and delete roles below their highest role',
      category: 'general',
      dangerous: true,
    },
    MANAGE_CATEGORIES: {
      name: 'Manage Categories',
      description: 'Create, edit, and delete channel categories',
      category: 'general',
    },
    KICK_MEMBERS: {
      name: 'Kick Members',
      description: 'Remove members from the server',
      category: 'membership',
    },
    BAN_MEMBERS: {
      name: 'Ban Members',
      description: 'Permanently ban members from the server',
      category: 'membership',
      dangerous: true,
    },
    TIMEOUT_MEMBERS: {
      name: 'Timeout Members',
      description: 'Temporarily prevent members from communicating',
      category: 'membership',
    },
    MANAGE_NICKNAMES: {
      name: 'Manage Nicknames',
      description: "Change other members' nicknames",
      category: 'membership',
    },
    CREATE_INVITES: {
      name: 'Create Invites',
      description: 'Create invite links to the server',
      category: 'membership',
    },
    MANAGE_INVITES: {
      name: 'Manage Invites',
      description: 'View and delete invite links',
      category: 'membership',
    },
    CHANGE_NICKNAME: {
      name: 'Change Nickname',
      description: 'Change your own nickname',
      category: 'membership',
    },
    VIEW_AUDIT_LOG: {
      name: 'View Audit Log',
      description: 'View the server audit log',
      category: 'advanced',
    },
    VIEW_SERVER_INSIGHTS: {
      name: 'View Server Insights',
      description: 'View server analytics and statistics',
      category: 'advanced',
    },
    MANAGE_EMOJIS: {
      name: 'Manage Emojis',
      description: 'Create, edit, and delete custom emojis',
      category: 'advanced',
    },
    MANAGE_STICKERS: {
      name: 'Manage Stickers',
      description: 'Create, edit, and delete stickers',
      category: 'advanced',
    },
    MANAGE_EXPRESSIONS: {
      name: 'Manage Expressions',
      description: 'Manage all expressions including soundboard',
      category: 'advanced',
    },
    MANAGE_WEBHOOKS: {
      name: 'Manage Webhooks',
      description: 'Create, edit, and delete webhooks',
      category: 'advanced',
    },
    CREATE_EVENTS: {
      name: 'Create Events',
      description: 'Create server events',
      category: 'advanced',
    },
    MANAGE_EVENTS: {
      name: 'Manage Events',
      description: 'Edit and delete server events',
      category: 'advanced',
    },
    MANAGE_THREADS: {
      name: 'Manage Threads',
      description: 'Manage all threads in the server',
      category: 'text',
    },
    CREATE_PUBLIC_THREADS: {
      name: 'Create Public Threads',
      description: 'Create public threads in channels',
      category: 'text',
    },
    CREATE_PRIVATE_THREADS: {
      name: 'Create Private Threads',
      description: 'Create private threads in channels',
      category: 'text',
    },
    VIEW_SERVER_MEMBERS: {
      name: 'View Server Members',
      description: 'View the member list',
      category: 'membership',
    },
    MODERATE_MEMBERS: {
      name: 'Moderate Members',
      description: 'Access auto-moderation and member screening',
      category: 'membership',
    },
  };

/**
 * Text permission metadata for UI
 */
export const TextPermissionMetadata: Record<keyof typeof TextPermissions, PermissionMetadata> = {
  VIEW_CHANNEL: {
    name: 'View Channel',
    description: 'See this channel in the channel list',
    category: 'text',
  },
  SEND_MESSAGES: {
    name: 'Send Messages',
    description: 'Send messages in this channel',
    category: 'text',
  },
  SEND_TTS_MESSAGES: {
    name: 'Send TTS Messages',
    description: 'Send text-to-speech messages',
    category: 'text',
  },
  READ_MESSAGE_HISTORY: {
    name: 'Read Message History',
    description: 'Read past messages in this channel',
    category: 'text',
  },
  EMBED_LINKS: {
    name: 'Embed Links',
    description: 'Post links with automatic previews',
    category: 'text',
  },
  ATTACH_FILES: {
    name: 'Attach Files',
    description: 'Upload files and images',
    category: 'text',
  },
  USE_EXTERNAL_EMOJIS: {
    name: 'Use External Emojis',
    description: 'Use emojis from other servers',
    category: 'text',
  },
  USE_EXTERNAL_STICKERS: {
    name: 'Use External Stickers',
    description: 'Use stickers from other servers',
    category: 'text',
  },
  ADD_REACTIONS: {
    name: 'Add Reactions',
    description: 'Add reactions to messages',
    category: 'text',
  },
  MENTION_EVERYONE: {
    name: 'Mention Everyone',
    description: 'Use @everyone and @here mentions',
    category: 'text',
  },
  MENTION_ROLES: {
    name: 'Mention Roles',
    description: 'Mention any role including non-mentionable ones',
    category: 'text',
  },
  MANAGE_MESSAGES: {
    name: 'Manage Messages',
    description: "Delete and pin other users' messages",
    category: 'text',
  },
  DELETE_OWN_MESSAGES: {
    name: 'Delete Own Messages',
    description: 'Delete your own messages',
    category: 'text',
  },
  EDIT_OWN_MESSAGES: {
    name: 'Edit Own Messages',
    description: 'Edit your own messages',
    category: 'text',
  },
  CREATE_PUBLIC_THREADS: {
    name: 'Create Public Threads',
    description: 'Create public threads',
    category: 'text',
  },
  CREATE_PRIVATE_THREADS: {
    name: 'Create Private Threads',
    description: 'Create private threads',
    category: 'text',
  },
  SEND_MESSAGES_IN_THREADS: {
    name: 'Send Messages in Threads',
    description: 'Send messages in threads',
    category: 'text',
  },
  MANAGE_THREADS: {
    name: 'Manage Threads',
    description: 'Archive and delete threads',
    category: 'text',
  },
  USE_APPLICATION_COMMANDS: {
    name: 'Use Application Commands',
    description: 'Use slash commands and bot interactions',
    category: 'text',
  },
  MANAGE_WEBHOOKS: {
    name: 'Manage Webhooks',
    description: 'Manage webhooks in this channel',
    category: 'advanced',
  },
  BYPASS_SLOWMODE: {
    name: 'Bypass Slowmode',
    description: 'Ignore slowmode restrictions',
    category: 'text',
  },
};

/**
 * Voice permission metadata for UI
 */
export const VoicePermissionMetadata: Record<keyof typeof VoicePermissions, PermissionMetadata> = {
  CONNECT: {
    name: 'Connect',
    description: 'Join voice channels',
    category: 'voice',
  },
  VIEW_CHANNEL: {
    name: 'View Channel',
    description: 'See voice channels in the channel list',
    category: 'voice',
  },
  SPEAK: {
    name: 'Speak',
    description: 'Transmit audio in voice channels',
    category: 'voice',
  },
  VIDEO: {
    name: 'Video',
    description: 'Share video/camera',
    category: 'voice',
  },
  STREAM: {
    name: 'Stream',
    description: 'Share screen in voice channels',
    category: 'voice',
  },
  USE_VOICE_ACTIVITY: {
    name: 'Use Voice Activity',
    description: 'Use voice activity detection instead of push-to-talk',
    category: 'voice',
  },
  PRIORITY_SPEAKER: {
    name: 'Priority Speaker',
    description: 'Be heard more easily when speaking',
    category: 'voice',
  },
  USE_SOUNDBOARD: {
    name: 'Use Soundboard',
    description: 'Play soundboard sounds',
    category: 'voice',
  },
  USE_EXTERNAL_SOUNDS: {
    name: 'Use External Sounds',
    description: 'Use sounds from other servers',
    category: 'voice',
  },
  MUTE_MEMBERS: {
    name: 'Mute Members',
    description: 'Server mute other members',
    category: 'voice',
  },
  DEAFEN_MEMBERS: {
    name: 'Deafen Members',
    description: 'Server deafen other members',
    category: 'voice',
  },
  MOVE_MEMBERS: {
    name: 'Move Members',
    description: 'Move members to other voice channels',
    category: 'voice',
  },
  DISCONNECT_MEMBERS: {
    name: 'Disconnect Members',
    description: 'Disconnect members from voice',
    category: 'voice',
  },
  REQUEST_TO_SPEAK: {
    name: 'Request to Speak',
    description: 'Request to speak in stage channels',
    category: 'voice',
  },
  MANAGE_STAGE: {
    name: 'Manage Stage',
    description: 'Manage stage speakers',
    category: 'voice',
  },
  MANAGE_VOICE_CHANNEL: {
    name: 'Manage Voice Channel',
    description: 'Edit voice channel settings',
    category: 'voice',
  },
  SET_VOICE_STATUS: {
    name: 'Set Voice Status',
    description: 'Set a custom voice channel status',
    category: 'voice',
  },
};
