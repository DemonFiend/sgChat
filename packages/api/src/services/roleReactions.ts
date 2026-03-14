import { SYSTEM_USER_ID } from '@sgchat/shared';
import { sql } from '../lib/db.js';
import { publishEvent } from '../lib/eventBus.js';

// Mapping type for default role groups
interface DefaultMapping {
  emoji: string; // Unicode char or :shortcode: for custom
  emoji_type: 'unicode' | 'custom';
  shortcode?: string; // Custom emoji shortcode (without colons)
  label: string;
  color: string | null;
}

interface DefaultRoleGroup {
  name: string;
  description: string;
  position: number;
  exclusive?: boolean;
  mappings: DefaultMapping[];
}

// Default role groups with pre-created roles and emoji mappings
export const DEFAULT_ROLE_GROUPS: DefaultRoleGroup[] = [
  {
    name: 'Color Roles',
    description: 'React to choose a name color',
    position: 0,
    exclusive: true,
    mappings: [
      { emoji: ':member_red:', emoji_type: 'custom', shortcode: 'member_red', label: 'Red', color: '#e74c3c' },
      { emoji: ':member_blue:', emoji_type: 'custom', shortcode: 'member_blue', label: 'Blue', color: '#3498db' },
      { emoji: ':member_green:', emoji_type: 'custom', shortcode: 'member_green', label: 'Green', color: '#2ecc71' },
      { emoji: ':member_purple:', emoji_type: 'custom', shortcode: 'member_purple', label: 'Purple', color: '#9b59b6' },
      { emoji: ':member_yellow:', emoji_type: 'custom', shortcode: 'member_yellow', label: 'Yellow', color: '#f1c40f' },
      { emoji: ':member_orange:', emoji_type: 'custom', shortcode: 'member_orange', label: 'Orange', color: '#e67e22' },
      { emoji: ':member_white:', emoji_type: 'custom', shortcode: 'member_white', label: 'White', color: '#ecf0f1' },
      { emoji: ':member_black:', emoji_type: 'custom', shortcode: 'member_black', label: 'Black', color: '#2c3e50' },
    ],
  },
  {
    name: 'Pronoun Roles',
    description: 'React to set your pronouns',
    position: 1,
    mappings: [
      { emoji: ':cool_tiktok:', emoji_type: 'custom', shortcode: 'cool_tiktok', label: 'He/Him', color: null },
      { emoji: ':angel_tiktok:', emoji_type: 'custom', shortcode: 'angel_tiktok', label: 'She/Her', color: null },
      { emoji: ':proud_tiktok:', emoji_type: 'custom', shortcode: 'proud_tiktok', label: 'They/Them', color: null },
      { emoji: ':joyful_tiktok:', emoji_type: 'custom', shortcode: 'joyful_tiktok', label: 'Any Pronouns', color: null },
      { emoji: ':awkward_tiktok:', emoji_type: 'custom', shortcode: 'awkward_tiktok', label: 'Ask Me', color: null },
    ],
  },
  {
    name: 'Notification Roles',
    description: 'React to subscribe to server notifications',
    position: 2,
    mappings: [
      { emoji: ':channel:', emoji_type: 'custom', shortcode: 'channel', label: 'Announcements', color: null },
      { emoji: ':party:', emoji_type: 'custom', shortcode: 'party', label: 'Events', color: null },
      { emoji: ':sparkle7:', emoji_type: 'custom', shortcode: 'sparkle7', label: 'Updates', color: null },
      { emoji: ':steam_amt:', emoji_type: 'custom', shortcode: 'steam_amt', label: 'Game Nights', color: null },
      { emoji: ':excited_tiktok:', emoji_type: 'custom', shortcode: 'excited_tiktok', label: 'Voice Events', color: null },
    ],
  },
  {
    name: 'Region Roles',
    description: 'React to show your region',
    position: 3,
    mappings: [
      { emoji: ':canadaflag:', emoji_type: 'custom', shortcode: 'canadaflag', label: 'Canada', color: null },
      { emoji: ':unitedstatesflag:', emoji_type: 'custom', shortcode: 'unitedstatesflag', label: 'USA', color: null },
      { emoji: ':uk_flag:', emoji_type: 'custom', shortcode: 'uk_flag', label: 'United Kingdom', color: null },
      { emoji: '\u{1F1E9}\u{1F1EA}', emoji_type: 'unicode', label: 'Germany', color: null },
      { emoji: ':franceflag:', emoji_type: 'custom', shortcode: 'franceflag', label: 'France', color: null },
      { emoji: ':spainflag:', emoji_type: 'custom', shortcode: 'spainflag', label: 'Spain', color: null },
      { emoji: ':italy_flag:', emoji_type: 'custom', shortcode: 'italy_flag', label: 'Italy', color: null },
      { emoji: '\u{1F1F3}\u{1F1F1}', emoji_type: 'unicode', label: 'Netherlands', color: null },
      { emoji: ':sweedenflag:', emoji_type: 'custom', shortcode: 'sweedenflag', label: 'Sweden', color: null },
      { emoji: '\u{1F1F3}\u{1F1F4}', emoji_type: 'unicode', label: 'Norway', color: null },
      { emoji: ':denmarkflag:', emoji_type: 'custom', shortcode: 'denmarkflag', label: 'Denmark', color: null },
      { emoji: '\u{1F1EB}\u{1F1EE}', emoji_type: 'unicode', label: 'Finland', color: null },
      { emoji: ':polandflag:', emoji_type: 'custom', shortcode: 'polandflag', label: 'Poland', color: null },
      { emoji: ':brazilflag:', emoji_type: 'custom', shortcode: 'brazilflag', label: 'Brazil', color: null },
      { emoji: ':mexicoflag:', emoji_type: 'custom', shortcode: 'mexicoflag', label: 'Mexico', color: null },
      { emoji: ':japanflag:', emoji_type: 'custom', shortcode: 'japanflag', label: 'Japan', color: null },
      { emoji: '\u{1F1F0}\u{1F1F7}', emoji_type: 'unicode', label: 'South Korea', color: null },
      { emoji: ':chinaflag:', emoji_type: 'custom', shortcode: 'chinaflag', label: 'China', color: null },
      { emoji: '\u{1F1EE}\u{1F1F3}', emoji_type: 'unicode', label: 'India', color: null },
      { emoji: ':australia:', emoji_type: 'custom', shortcode: 'australia', label: 'Australia', color: null },
      { emoji: '\u{1F1F3}\u{1F1FF}', emoji_type: 'unicode', label: 'New Zealand', color: null },
      { emoji: ':southafricaflag:', emoji_type: 'custom', shortcode: 'southafricaflag', label: 'South Africa', color: null },
      { emoji: ':flag_un:', emoji_type: 'custom', shortcode: 'flag_un', label: 'Other', color: null },
    ],
  },
  {
    name: 'Platform Roles',
    description: 'React to show your primary platform',
    position: 4,
    mappings: [
      { emoji: ':pc:', emoji_type: 'custom', shortcode: 'pc', label: 'PC', color: null },
      { emoji: ':playstation:', emoji_type: 'custom', shortcode: 'playstation', label: 'PlayStation', color: null },
      { emoji: ':xbox:', emoji_type: 'custom', shortcode: 'xbox', label: 'Xbox', color: null },
      { emoji: ':mobilephone:', emoji_type: 'custom', shortcode: 'mobilephone', label: 'Mobile', color: null },
      { emoji: '\u{1F97D}', emoji_type: 'unicode', label: 'VR', color: null },
      { emoji: ':nintendo_switch:', emoji_type: 'custom', shortcode: 'nintendo_switch', label: 'Nintendo', color: null },
    ],
  },
  {
    name: 'Server Access Roles',
    description: 'React to unlock specific channels or content',
    position: 5,
    mappings: [
      { emoji: '\u{1F51E}', emoji_type: 'unicode', label: '18+ Content', color: null },
      { emoji: ':bot:', emoji_type: 'custom', shortcode: 'bot', label: 'Bot Commands', color: null },
    ],
  },
  {
    name: 'Personality Roles',
    description: 'React to show your vibe',
    position: 6,
    mappings: [
      { emoji: ':nap_tiktok:', emoji_type: 'custom', shortcode: 'nap_tiktok', label: 'Lurker', color: null },
      { emoji: ':laugh_tiktok:', emoji_type: 'custom', shortcode: 'laugh_tiktok', label: 'Talkative', color: null },
      { emoji: ':rage_tiktok:', emoji_type: 'custom', shortcode: 'rage_tiktok', label: 'Chaos', color: null },
      { emoji: ':think:', emoji_type: 'custom', shortcode: 'think', label: 'Big Brain', color: null },
      { emoji: ':evil_tiktok:', emoji_type: 'custom', shortcode: 'evil_tiktok', label: 'Goblin Mode', color: null },
    ],
  },
];

/**
 * Resolve a custom emoji shortcode to its ID for a given server.
 * Returns null if the emoji is not found or its pack is disabled.
 */
async function resolveCustomEmojiId(
  tx: any,
  serverId: string,
  shortcode: string
): Promise<string | null> {
  const [emoji] = await tx`
    SELECT e.id FROM emojis e
    JOIN emoji_packs ep ON e.pack_id = ep.id
    WHERE e.server_id = ${serverId}
      AND e.shortcode = ${shortcode}
      AND ep.enabled = true
    LIMIT 1
  `;
  return emoji?.id || null;
}

/**
 * Build message content for a role reaction group
 */
export function buildMessageContent(
  groupName: string,
  description: string | null,
  mappings: any[]
): string {
  let content = `**Category:** ${groupName}`;
  if (description) {
    content += `\n${description}`;
  }
  for (const m of mappings) {
    const roleRef = m.role_id ? `<@&${m.role_id}>` : `@${m.label || m.role_name || 'Unknown Role'}`;
    const emojiDisplay =
      m.emoji_type === 'custom' && m.custom_emoji_shortcode
        ? `:${m.custom_emoji_shortcode}:`
        : m.emoji_type === 'custom' && m.shortcode
          ? `:${m.shortcode}:`
          : m.emoji;
    content += `\nPlease React ${emojiDisplay} to obtain ${roleRef}`;
  }
  return content;
}

/**
 * Post a role reaction message for a group. Returns the created message.
 * Uses a transaction context if provided, otherwise runs standalone.
 */
export async function postRoleReactionMessage(
  tx: any,
  groupId: string,
  serverId: string,
  channelId: string,
  groupName: string,
  description: string | null,
  mappings: any[],
  exclusive?: boolean
) {
  const content = buildMessageContent(groupName, description, mappings);

  const [message] = await tx`
    INSERT INTO messages (
      channel_id, author_id, content, system_event
    )
    VALUES (
      ${channelId},
      NULL,
      ${content},
      ${JSON.stringify({
        type: 'role_reaction',
        group_id: groupId,
        group_name: groupName,
        description: description || null,
        exclusive: exclusive ?? false,
      })}
    )
    RETURNING *
  `;

  // Update group with message_id
  await tx`
    UPDATE role_reaction_groups
    SET message_id = ${message.id}, updated_at = NOW()
    WHERE id = ${groupId}
  `;

  // Add the emoji reactions to the message so users can just click them
  for (const m of mappings) {
    if (m.emoji_type === 'custom' && m.custom_emoji_id) {
      await tx`
        INSERT INTO message_reactions (message_id, user_id, reaction_type, custom_emoji_id)
        VALUES (${message.id}, ${SYSTEM_USER_ID}, 'custom', ${m.custom_emoji_id})
        ON CONFLICT DO NOTHING
      `;
    } else {
      await tx`
        INSERT INTO message_reactions (message_id, user_id, reaction_type, unicode_emoji)
        VALUES (${message.id}, ${SYSTEM_USER_ID}, 'unicode', ${m.emoji})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  return message;
}

/**
 * Refresh the message content for a group (after mapping changes)
 */
export async function refreshGroupMessage(groupId: string) {
  const [group] = await sql`
    SELECT * FROM role_reaction_groups WHERE id = ${groupId}
  `;
  if (!group || !group.message_id) return;

  const mappings = await sql`
    SELECT rrm.*, r.name as role_name, r.color as role_color,
      e.shortcode as custom_emoji_shortcode
    FROM role_reaction_mappings rrm
    JOIN roles r ON rrm.role_id = r.id
    LEFT JOIN emojis e ON rrm.custom_emoji_id = e.id
    WHERE rrm.group_id = ${groupId}
    ORDER BY rrm.position ASC
  `;

  const content = buildMessageContent(group.name, group.description, mappings);

  await sql`
    UPDATE messages
    SET content = ${content},
        system_event = ${JSON.stringify({
          type: 'role_reaction',
          group_id: groupId,
          group_name: group.name,
          description: group.description || null,
          exclusive: group.exclusive ?? false,
        })},
        edited_at = NOW()
    WHERE id = ${group.message_id}
  `;

  // Publish message.update event
  await publishEvent({
    type: 'message.update',
    resourceId: `channel:${group.channel_id}`,
    actorId: null,
    payload: {
      id: group.message_id,
      channel_id: group.channel_id,
      content,
      edited_at: new Date().toISOString(),
    },
  });
}

export interface RoleAssignmentResult {
  assignedRoleId: string;
  removedRoleIds: string[];
  removedReactions: Array<{
    emoji: string;
    emoji_type: 'unicode' | 'custom';
    custom_emoji_id: string | null;
  }>;
}

/**
 * Handle a reaction on a role-reaction message.
 * Returns assignment result if a role was assigned, null otherwise.
 * For exclusive groups, removes other roles/reactions from the same group.
 */
export async function assignRoleFromReaction(
  userId: string,
  serverId: string,
  emoji: string,
  messageId: string,
  customEmojiId?: string
): Promise<RoleAssignmentResult | null> {
  // Check if this message is a role-reaction message
  const [group] = await sql`
    SELECT rrg.id, rrg.enabled, rrg.exclusive
    FROM role_reaction_groups rrg
    WHERE rrg.message_id = ${messageId} AND rrg.enabled = true
  `;
  if (!group) return null;

  // Look up the emoji mapping (custom emoji by ID, unicode by emoji string)
  let mapping;
  if (customEmojiId) {
    [mapping] = await sql`
      SELECT rrm.role_id
      FROM role_reaction_mappings rrm
      WHERE rrm.group_id = ${group.id} AND rrm.emoji_type = 'custom' AND rrm.custom_emoji_id = ${customEmojiId}
    `;
  } else {
    [mapping] = await sql`
      SELECT rrm.role_id
      FROM role_reaction_mappings rrm
      WHERE rrm.group_id = ${group.id} AND rrm.emoji_type = 'unicode' AND rrm.emoji = ${emoji}
    `;
  }
  if (!mapping) return null;

  const removedRoleIds: string[] = [];
  const removedReactions: RoleAssignmentResult['removedReactions'] = [];

  // If exclusive, remove other roles and reactions from this group first
  if (group.exclusive) {
    // Get all OTHER mappings in this group
    const otherMappings = await sql`
      SELECT rrm.role_id, rrm.emoji, rrm.emoji_type, rrm.custom_emoji_id
      FROM role_reaction_mappings rrm
      WHERE rrm.group_id = ${group.id} AND rrm.role_id != ${mapping.role_id}
    `;

    if (otherMappings.length > 0) {
      const otherRoleIds = otherMappings.map((m: any) => m.role_id);

      // Remove user's other roles from this group
      const removed = await sql`
        DELETE FROM member_roles
        WHERE member_user_id = ${userId}
          AND member_server_id = ${serverId}
          AND role_id = ANY(${otherRoleIds})
        RETURNING role_id
      `;
      for (const r of removed) {
        removedRoleIds.push(r.role_id);
      }

      // Remove user's reactions for those other mappings on this message
      const unicodeEmojis = otherMappings
        .filter((m: any) => m.emoji_type === 'unicode')
        .map((m: any) => m.emoji);
      const customEmojiIds = otherMappings
        .filter((m: any) => m.emoji_type === 'custom' && m.custom_emoji_id)
        .map((m: any) => m.custom_emoji_id);

      if (unicodeEmojis.length > 0) {
        await sql`
          DELETE FROM message_reactions
          WHERE message_id = ${messageId}
            AND user_id = ${userId}
            AND reaction_type = 'unicode'
            AND unicode_emoji = ANY(${unicodeEmojis})
        `;
      }
      if (customEmojiIds.length > 0) {
        await sql`
          DELETE FROM message_reactions
          WHERE message_id = ${messageId}
            AND user_id = ${userId}
            AND reaction_type = 'custom'
            AND custom_emoji_id = ANY(${customEmojiIds})
        `;
      }

      // Track which reactions were removed (only those the user actually had roles for)
      for (const m of otherMappings) {
        if (removedRoleIds.includes(m.role_id)) {
          removedReactions.push({
            emoji: m.emoji,
            emoji_type: m.emoji_type,
            custom_emoji_id: m.custom_emoji_id,
          });
        }
      }
    }
  }

  // Assign the role (ignore if already assigned)
  await sql`
    INSERT INTO member_roles (member_user_id, member_server_id, role_id)
    VALUES (${userId}, ${serverId}, ${mapping.role_id})
    ON CONFLICT (member_user_id, member_server_id, role_id) DO NOTHING
  `;

  return { assignedRoleId: mapping.role_id, removedRoleIds, removedReactions };
}

/**
 * Handle unreaction on a role-reaction message.
 * Returns the role_id if a role was removed, null otherwise.
 */
export async function removeRoleFromReaction(
  userId: string,
  serverId: string,
  emoji: string,
  messageId: string,
  customEmojiId?: string
): Promise<string | null> {
  // Check if this message is a role-reaction message
  const [group] = await sql`
    SELECT rrg.id, rrg.enabled
    FROM role_reaction_groups rrg
    WHERE rrg.message_id = ${messageId} AND rrg.enabled = true
  `;
  if (!group) return null;

  // Look up the emoji mapping (custom emoji by ID, unicode by emoji string)
  let mapping;
  if (customEmojiId) {
    [mapping] = await sql`
      SELECT rrm.role_id
      FROM role_reaction_mappings rrm
      WHERE rrm.group_id = ${group.id} AND rrm.emoji_type = 'custom' AND rrm.custom_emoji_id = ${customEmojiId}
    `;
  } else {
    [mapping] = await sql`
      SELECT rrm.role_id
      FROM role_reaction_mappings rrm
      WHERE rrm.group_id = ${group.id} AND rrm.emoji_type = 'unicode' AND rrm.emoji = ${emoji}
    `;
  }
  if (!mapping) return null;

  // Remove the role
  const result = await sql`
    DELETE FROM member_roles
    WHERE member_user_id = ${userId}
      AND member_server_id = ${serverId}
      AND role_id = ${mapping.role_id}
  `;

  return result.count > 0 ? mapping.role_id : null;
}

/**
 * Strip all roles assigned via a group's mappings from all members
 */
export async function stripRolesForGroup(groupId: string): Promise<number> {
  const result = await sql`
    DELETE FROM member_roles
    WHERE role_id IN (
      SELECT role_id FROM role_reaction_mappings WHERE group_id = ${groupId}
    )
  `;
  return result.count;
}

/**
 * Create the 7 default role groups with pre-created roles and emoji mappings.
 * Returns the created groups.
 */
export async function createDefaultGroups(
  serverId: string,
  channelId: string,
  externalTx?: any
) {
  const doWork = async (tx: any) => {
    const createdGroups = [];

    for (const groupDef of DEFAULT_ROLE_GROUPS) {
      // Create the group
      const [group] = await tx`
        INSERT INTO role_reaction_groups (server_id, channel_id, name, description, position, enabled, exclusive)
        VALUES (${serverId}, ${channelId}, ${groupDef.name}, ${groupDef.description}, ${groupDef.position}, true, ${groupDef.exclusive ?? false})
        RETURNING *
      `;

      const mappings = [];

      for (let i = 0; i < groupDef.mappings.length; i++) {
        const m = groupDef.mappings[i];

        // Create the role (position 1, cosmetic only, no permissions)
        const [role] = await tx`
          INSERT INTO roles (
            server_id, name, position, color,
            server_permissions, text_permissions, voice_permissions,
            is_hoisted, is_mentionable, description
          )
          VALUES (
            ${serverId},
            ${m.label},
            1,
            ${m.color},
            '0', '0', '0',
            false, false, NULL
          )
          ON CONFLICT (server_id, name) DO UPDATE SET name = roles.name
          RETURNING *
        `;

        // Resolve custom emoji ID if this mapping uses a custom emoji
        let customEmojiId: string | null = null;
        let emojiType = m.emoji_type;
        let emojiValue = m.emoji;

        if (m.emoji_type === 'custom' && m.shortcode) {
          customEmojiId = await resolveCustomEmojiId(tx, serverId, m.shortcode);
          if (!customEmojiId) {
            // Fallback to unicode if custom emoji not found
            console.warn(
              `[RoleReactions] Custom emoji :${m.shortcode}: not found for server ${serverId}, falling back to unicode`
            );
            emojiType = 'unicode';
            emojiValue = m.label.charAt(0); // Use first letter as fallback
          }
        }

        // Create the mapping
        const [mapping] = await tx`
          INSERT INTO role_reaction_mappings (group_id, role_id, emoji, emoji_type, custom_emoji_id, label, position)
          VALUES (${group.id}, ${role.id}, ${emojiValue}, ${emojiType}, ${customEmojiId}, ${m.label}, ${i})
          RETURNING *
        `;

        mappings.push({ ...mapping, role_name: role.name, role_color: role.color });
      }

      // Post the role reaction message
      const message = await postRoleReactionMessage(
        tx,
        group.id,
        serverId,
        channelId,
        groupDef.name,
        groupDef.description,
        mappings,
        groupDef.exclusive
      );

      createdGroups.push({
        ...group,
        message_id: message.id,
        mappings,
      });
    }

    return createdGroups;
  };

  if (externalTx) return doWork(externalTx);
  return sql.begin(doWork);
}

/**
 * Refresh all role reaction group messages for a server.
 * Regenerates message content with proper <@&uuid> wire format.
 */
export async function refreshAllGroupMessages(serverId: string) {
  const groups = await sql`
    SELECT id FROM role_reaction_groups
    WHERE server_id = ${serverId} AND message_id IS NOT NULL
  `;

  for (const group of groups) {
    await refreshGroupMessage(group.id);
  }

  return groups.length;
}

/**
 * Get all role reaction groups for a server with their mappings
 */
export async function getGroupsForServer(serverId: string) {
  const groups = await sql`
    SELECT * FROM role_reaction_groups
    WHERE server_id = ${serverId}
    ORDER BY position ASC
  `;

  const result = [];
  for (const group of groups) {
    const mappings = await sql`
      SELECT rrm.*, r.name as role_name, r.color as role_color,
        e.shortcode as custom_emoji_shortcode, e.asset_key as custom_emoji_asset_key
      FROM role_reaction_mappings rrm
      JOIN roles r ON rrm.role_id = r.id
      LEFT JOIN emojis e ON rrm.custom_emoji_id = e.id
      WHERE rrm.group_id = ${group.id}
      ORDER BY rrm.position ASC
    `;

    // Enrich custom emoji mappings with URLs
    const enrichedMappings = mappings.map((m: any) => {
      if (m.emoji_type === 'custom' && m.custom_emoji_asset_key) {
        return {
          ...m,
          custom_emoji_url: m.custom_emoji_asset_key,
          custom_emoji_asset_key: undefined,
        };
      }
      return { ...m, custom_emoji_asset_key: undefined };
    });

    result.push({ ...group, mappings: enrichedMappings });
  }

  return result;
}

/**
 * Count non-role-reaction messages in a channel
 */
export async function countNonRoleMessages(channelId: string): Promise<number> {
  const [result] = await sql`
    SELECT COUNT(*)::int as count
    FROM messages
    WHERE channel_id = ${channelId}
      AND (system_event IS NULL OR system_event->>'type' != 'role_reaction')
  `;
  return result.count;
}

/**
 * Format a channel: delete all non-role-reaction messages, then repost all enabled groups in order.
 */
export async function formatChannel(serverId: string, channelId: string) {
  return sql.begin(async (tx: any) => {
    // Delete all non-role-reaction messages
    const deleteResult = await tx`
      DELETE FROM messages
      WHERE channel_id = ${channelId}
        AND (system_event IS NULL OR system_event->>'type' != 'role_reaction')
    `;

    // Also delete existing role-reaction messages (we'll repost them in order)
    await tx`
      DELETE FROM messages
      WHERE channel_id = ${channelId}
        AND system_event->>'type' = 'role_reaction'
    `;

    // Clear message_ids on all groups for this channel
    await tx`
      UPDATE role_reaction_groups
      SET message_id = NULL
      WHERE channel_id = ${channelId}
    `;

    // Get all enabled groups for this channel in order
    const groups = await tx`
      SELECT * FROM role_reaction_groups
      WHERE channel_id = ${channelId} AND enabled = true
      ORDER BY position ASC
    `;

    let groupsReposted = 0;
    for (const group of groups) {
      const mappings = await tx`
        SELECT rrm.*, r.name as role_name, r.color as role_color,
          e.shortcode as custom_emoji_shortcode
        FROM role_reaction_mappings rrm
        JOIN roles r ON rrm.role_id = r.id
        LEFT JOIN emojis e ON rrm.custom_emoji_id = e.id
        WHERE rrm.group_id = ${group.id}
        ORDER BY rrm.position ASC
      `;

      await postRoleReactionMessage(
        tx,
        group.id,
        serverId,
        channelId,
        group.name,
        group.description,
        mappings,
        group.exclusive
      );
      groupsReposted++;
    }

    return {
      messages_deleted: deleteResult.count,
      groups_reposted: groupsReposted,
    };
  });
}
