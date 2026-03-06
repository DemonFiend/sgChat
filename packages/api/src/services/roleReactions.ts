import { SYSTEM_USER_ID } from '@sgchat/shared';
import { sql } from '../lib/db.js';
import { publishEvent } from '../lib/eventBus.js';

// Default role groups with pre-created roles and emoji mappings
export const DEFAULT_ROLE_GROUPS = [
  {
    name: 'Color Roles',
    description: 'React to choose a name color',
    position: 0,
    mappings: [
      { emoji: '🔴', label: 'Red', color: '#e74c3c' },
      { emoji: '🔵', label: 'Blue', color: '#3498db' },
      { emoji: '🟢', label: 'Green', color: '#2ecc71' },
      { emoji: '🟣', label: 'Purple', color: '#9b59b6' },
      { emoji: '🟡', label: 'Yellow', color: '#f1c40f' },
      { emoji: '🟠', label: 'Orange', color: '#e67e22' },
      { emoji: '⚪', label: 'White', color: '#ecf0f1' },
      { emoji: '⚫', label: 'Black', color: '#2c3e50' },
    ],
  },
  {
    name: 'Pronoun Roles',
    description: 'React to set your pronouns',
    position: 1,
    mappings: [
      { emoji: '💙', label: 'He/Him', color: null },
      { emoji: '💜', label: 'She/Her', color: null },
      { emoji: '💚', label: 'They/Them', color: null },
      { emoji: '💛', label: 'Any Pronouns', color: null },
      { emoji: '❓', label: 'Ask Me', color: null },
    ],
  },
  {
    name: 'Notification Roles',
    description: 'React to subscribe to server notifications',
    position: 2,
    mappings: [
      { emoji: '📢', label: 'Announcements', color: null },
      { emoji: '🎉', label: 'Events', color: null },
      { emoji: '🔄', label: 'Updates', color: null },
      { emoji: '🎮', label: 'Game Nights', color: null },
      { emoji: '🔊', label: 'Voice Events', color: null },
    ],
  },
  {
    name: 'Region Roles',
    description: 'React to show your region',
    position: 3,
    mappings: [
      { emoji: '🇨🇦', label: 'Canada', color: null },
      { emoji: '🇺🇸', label: 'USA', color: null },
      { emoji: '🇬🇧', label: 'United Kingdom', color: null },
      { emoji: '🇩🇪', label: 'Germany', color: null },
      { emoji: '🇫🇷', label: 'France', color: null },
      { emoji: '🇪🇸', label: 'Spain', color: null },
      { emoji: '🇮🇹', label: 'Italy', color: null },
      { emoji: '🇳🇱', label: 'Netherlands', color: null },
      { emoji: '🇸🇪', label: 'Sweden', color: null },
      { emoji: '🇳🇴', label: 'Norway', color: null },
      { emoji: '🇩🇰', label: 'Denmark', color: null },
      { emoji: '🇫🇮', label: 'Finland', color: null },
      { emoji: '🇵🇱', label: 'Poland', color: null },
      { emoji: '🇧🇷', label: 'Brazil', color: null },
      { emoji: '🇲🇽', label: 'Mexico', color: null },
      { emoji: '🇯🇵', label: 'Japan', color: null },
      { emoji: '🇰🇷', label: 'South Korea', color: null },
      { emoji: '🇨🇳', label: 'China', color: null },
      { emoji: '🇮🇳', label: 'India', color: null },
      { emoji: '🇦🇺', label: 'Australia', color: null },
      { emoji: '🇳🇿', label: 'New Zealand', color: null },
      { emoji: '🇿🇦', label: 'South Africa', color: null },
      { emoji: '🌍', label: 'Other', color: null },
    ],
  },
  {
    name: 'Platform Roles',
    description: 'React to show your primary platform',
    position: 4,
    mappings: [
      { emoji: '🖥️', label: 'PC', color: null },
      { emoji: '🎯', label: 'PlayStation', color: null },
      { emoji: '🟩', label: 'Xbox', color: null },
      { emoji: '📱', label: 'Mobile', color: null },
      { emoji: '🥽', label: 'VR', color: null },
      { emoji: '🍄', label: 'Nintendo', color: null },
    ],
  },
  {
    name: 'Server Access Roles',
    description: 'React to unlock specific channels or content',
    position: 5,
    mappings: [
      { emoji: '🔞', label: '18+ Content', color: null },
      { emoji: '🤖', label: 'Bot Commands', color: null },
    ],
  },
  {
    name: 'Personality Roles',
    description: 'React to show your vibe',
    position: 6,
    mappings: [
      { emoji: '👻', label: 'Lurker', color: null },
      { emoji: '💬', label: 'Talkative', color: null },
      { emoji: '🌪️', label: 'Chaos', color: null },
      { emoji: '🧠', label: 'Big Brain', color: null },
      { emoji: '👺', label: 'Goblin Mode', color: null },
    ],
  },
];

/**
 * Build message content for a role reaction group
 */
export function buildMessageContent(
  groupName: string,
  description: string | null,
  mappings: any[]
): string {
  let content = `**${groupName}**`;
  if (description) {
    content += `\n${description}`;
  }
  content += '\n';
  for (const m of mappings) {
    const displayName = m.label || m.role_name || 'Unknown Role';
    content += `\n${m.emoji} — ${displayName}`;
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
  mappings: any[]
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
    await tx`
      INSERT INTO message_reactions (message_id, user_id, emoji)
      VALUES (${message.id}, ${SYSTEM_USER_ID}, ${m.emoji})
      ON CONFLICT DO NOTHING
    `;
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
    SELECT rrm.*, r.name as role_name, r.color as role_color
    FROM role_reaction_mappings rrm
    JOIN roles r ON rrm.role_id = r.id
    WHERE rrm.group_id = ${groupId}
    ORDER BY rrm.position ASC
  `;

  const content = buildMessageContent(group.name, group.description, mappings);

  await sql`
    UPDATE messages
    SET content = ${content}, edited_at = NOW()
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

/**
 * Handle a reaction on a role-reaction message.
 * Returns the role_id if a role was assigned, null otherwise.
 */
export async function assignRoleFromReaction(
  userId: string,
  serverId: string,
  emoji: string,
  messageId: string
): Promise<string | null> {
  // Check if this message is a role-reaction message
  const [group] = await sql`
    SELECT rrg.id, rrg.enabled
    FROM role_reaction_groups rrg
    WHERE rrg.message_id = ${messageId} AND rrg.enabled = true
  `;
  if (!group) return null;

  // Look up the emoji mapping
  const [mapping] = await sql`
    SELECT rrm.role_id
    FROM role_reaction_mappings rrm
    WHERE rrm.group_id = ${group.id} AND rrm.emoji = ${emoji}
  `;
  if (!mapping) return null;

  // Assign the role (ignore if already assigned)
  await sql`
    INSERT INTO member_roles (member_user_id, member_server_id, role_id)
    VALUES (${userId}, ${serverId}, ${mapping.role_id})
    ON CONFLICT (member_user_id, member_server_id, role_id) DO NOTHING
  `;

  return mapping.role_id;
}

/**
 * Handle unreaction on a role-reaction message.
 * Returns the role_id if a role was removed, null otherwise.
 */
export async function removeRoleFromReaction(
  userId: string,
  serverId: string,
  emoji: string,
  messageId: string
): Promise<string | null> {
  // Check if this message is a role-reaction message
  const [group] = await sql`
    SELECT rrg.id, rrg.enabled
    FROM role_reaction_groups rrg
    WHERE rrg.message_id = ${messageId} AND rrg.enabled = true
  `;
  if (!group) return null;

  // Look up the emoji mapping
  const [mapping] = await sql`
    SELECT rrm.role_id
    FROM role_reaction_mappings rrm
    WHERE rrm.group_id = ${group.id} AND rrm.emoji = ${emoji}
  `;
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
        INSERT INTO role_reaction_groups (server_id, channel_id, name, description, position, enabled)
        VALUES (${serverId}, ${channelId}, ${groupDef.name}, ${groupDef.description}, ${groupDef.position}, true)
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

        // Create the mapping
        const [mapping] = await tx`
          INSERT INTO role_reaction_mappings (group_id, role_id, emoji, label, position)
          VALUES (${group.id}, ${role.id}, ${m.emoji}, ${m.label}, ${i})
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
        mappings
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
      SELECT rrm.*, r.name as role_name, r.color as role_color
      FROM role_reaction_mappings rrm
      JOIN roles r ON rrm.role_id = r.id
      WHERE rrm.group_id = ${group.id}
      ORDER BY rrm.position ASC
    `;
    result.push({ ...group, mappings });
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
        SELECT rrm.*, r.name as role_name, r.color as role_color
        FROM role_reaction_mappings rrm
        JOIN roles r ON rrm.role_id = r.id
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
        mappings
      );
      groupsReposted++;
    }

    return {
      messages_deleted: deleteResult.count,
      groups_reposted: groupsReposted,
    };
  });
}
