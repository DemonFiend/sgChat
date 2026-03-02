/**
 * Mention processing service.
 * Detects mentions in message content and creates notifications.
 */
import {
  extractMentionedUserIds,
  extractMentionedRoleIds,
  hasBroadcastMention,
  TextPermissions,
  hasPermission,
} from '@sgchat/shared';
import { db } from '../lib/db.js';
import { createNotification } from '../routes/notifications.js';
import { calculatePermissions } from './permissions.js';

export interface MentionContext {
  content: string;
  messageId: string;
  channelId: string;
  channelName: string;
  serverId: string;
  authorId: string;
  authorUsername: string;
  authorAvatarUrl: string | null;
}

/**
 * Process mentions in a message and create notifications.
 * Returns the set of user IDs that were notified (useful for reply dedup).
 */
export async function processMentions(ctx: MentionContext): Promise<Set<string>> {
  const notifiedUserIds = new Set<string>();

  // 1. Direct user mentions (<@userId>)
  const mentionedUserIds = extractMentionedUserIds(ctx.content);
  for (const targetUserId of mentionedUserIds.slice(0, 20)) {
    if (targetUserId === ctx.authorId) continue;

    // Verify the mentioned user is a server member
    const [membership] = await db.sql`
      SELECT 1 FROM members WHERE user_id = ${targetUserId} AND server_id = ${ctx.serverId}
    `;
    if (!membership) continue;

    notifiedUserIds.add(targetUserId);
    await createNotification({
      userId: targetUserId,
      type: 'mention',
      priority: 'high',
      data: {
        channel_id: ctx.channelId,
        channel_name: ctx.channelName,
        server_id: ctx.serverId,
        message_id: ctx.messageId,
        mention_type: 'user',
        from_user: {
          id: ctx.authorId,
          username: ctx.authorUsername,
          avatar_url: ctx.authorAvatarUrl,
        },
        message_preview: ctx.content.slice(0, 100),
      },
    });
  }

  // 2. Role mentions (<@&roleId>)
  const mentionedRoleIds = extractMentionedRoleIds(ctx.content);
  if (mentionedRoleIds.length > 0) {
    const authorPerms = await calculatePermissions(ctx.authorId, ctx.serverId, ctx.channelId);
    const canMentionAnyRole = hasPermission(authorPerms.text, TextPermissions.MENTION_ROLES);

    for (const roleId of mentionedRoleIds.slice(0, 10)) {
      const [role] = await db.sql`SELECT is_mentionable FROM roles WHERE id = ${roleId}`;
      if (!role) continue;
      if (!role.is_mentionable && !canMentionAnyRole) continue;

      const roleMembers = await db.sql`
        SELECT mr.member_user_id as user_id
        FROM member_roles mr
        WHERE mr.role_id = ${roleId}
          AND mr.member_server_id = ${ctx.serverId}
          AND mr.member_user_id != ${ctx.authorId}
      `;

      for (const member of roleMembers) {
        if (notifiedUserIds.has(member.user_id)) continue;
        notifiedUserIds.add(member.user_id);
        await createNotification({
          userId: member.user_id,
          type: 'mention',
          priority: 'high',
          data: {
            channel_id: ctx.channelId,
            channel_name: ctx.channelName,
            server_id: ctx.serverId,
            message_id: ctx.messageId,
            mention_type: 'role',
            role_id: roleId,
            from_user: {
              id: ctx.authorId,
              username: ctx.authorUsername,
              avatar_url: ctx.authorAvatarUrl,
            },
            message_preview: ctx.content.slice(0, 100),
          },
        });
      }
    }
  }

  // 3. @here / @everyone
  const broadcast = hasBroadcastMention(ctx.content);
  if (broadcast.here || broadcast.everyone) {
    const authorPerms = await calculatePermissions(ctx.authorId, ctx.serverId, ctx.channelId);
    if (hasPermission(authorPerms.text, TextPermissions.MENTION_EVERYONE)) {
      let targetMembers;
      if (broadcast.everyone) {
        targetMembers = await db.sql`
          SELECT user_id FROM members
          WHERE server_id = ${ctx.serverId} AND user_id != ${ctx.authorId}
        `;
      } else {
        // @here = online members only
        targetMembers = await db.sql`
          SELECT m.user_id FROM members m
          JOIN users u ON u.id = m.user_id
          WHERE m.server_id = ${ctx.serverId}
            AND m.user_id != ${ctx.authorId}
            AND u.status IN ('online', 'idle')
        `;
      }

      for (const member of targetMembers) {
        if (notifiedUserIds.has(member.user_id)) continue;
        notifiedUserIds.add(member.user_id);
        await createNotification({
          userId: member.user_id,
          type: 'mention',
          priority: 'normal',
          data: {
            channel_id: ctx.channelId,
            channel_name: ctx.channelName,
            server_id: ctx.serverId,
            message_id: ctx.messageId,
            mention_type: broadcast.everyone ? 'everyone' : 'here',
            from_user: {
              id: ctx.authorId,
              username: ctx.authorUsername,
              avatar_url: ctx.authorAvatarUrl,
            },
            message_preview: ctx.content.slice(0, 100),
          },
        });
      }
    }
  }

  return notifiedUserIds;
}
