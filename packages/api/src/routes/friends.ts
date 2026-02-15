import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { publishEvent } from '../lib/eventBus.js';
import { createNotification } from './notifications.js';
import { notFound, badRequest, forbidden } from '../utils/errors.js';

/**
 * Helper to check if two users are friends
 */
export async function areFriends(userId1: string, userId2: string): Promise<boolean> {
  const [min, max] = userId1 < userId2 ? [userId1, userId2] : [userId2, userId1];
  const [result] = await db.sql`
    SELECT 1 FROM friendships WHERE user1_id = ${min} AND user2_id = ${max}
  `;
  return !!result;
}

/**
 * Helper to check if there's a pending friend request between users
 */
async function getPendingRequest(fromUserId: string, toUserId: string) {
  const [request] = await db.sql`
    SELECT * FROM friend_requests 
    WHERE from_user_id = ${fromUserId} AND to_user_id = ${toUserId}
  `;
  return request;
}

/**
 * Helper to check if either user has blocked the other
 */
export async function isBlocked(userId1: string, userId2: string): Promise<boolean> {
  const [result] = await db.sql`
    SELECT 1 FROM blocked_users 
    WHERE (blocker_id = ${userId1} AND blocked_id = ${userId2})
       OR (blocker_id = ${userId2} AND blocked_id = ${userId1})
  `;
  return !!result;
}

export const friendRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /friends - List current user's friends
  fastify.get('/', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const userId = request.user!.id;

      // Get all friendships where user is either user1 or user2
      // Include timezone info from user_settings (only expose if timezone_public is true)
      const friends = await db.sql`
        SELECT 
          u.id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.status,
          u.custom_status_emoji,
          u.custom_status,
          u.last_seen_at,
          f.created_at as since,
          CASE WHEN us.timezone_public = true THEN us.timezone ELSE NULL END as timezone,
          COALESCE(us.timezone_public, false) as timezone_public,
          CASE WHEN us.timezone_public = true THEN COALESCE(us.timezone_dst_enabled, true) ELSE NULL END as timezone_dst_enabled
        FROM friendships f
        JOIN users u ON (
          CASE 
            WHEN f.user1_id = ${userId} THEN f.user2_id = u.id
            ELSE f.user1_id = u.id
          END
        )
        LEFT JOIN user_settings us ON us.user_id = u.id
        WHERE f.user1_id = ${userId} OR f.user2_id = ${userId}
        ORDER BY 
          CASE u.status 
            WHEN 'online' THEN 1 
            WHEN 'idle' THEN 2 
            WHEN 'dnd' THEN 3
            WHEN 'offline' THEN 4
            ELSE 5 
          END,
          u.username ASC
      `;

      return friends.map((f: any) => ({
        id: f.id,
        username: f.username,
        display_name: f.display_name || f.username,
        avatar_url: f.avatar_url,
        status: f.status,
        custom_status: f.custom_status || null,
        since: f.since,
        last_seen_at: f.last_seen_at || null,
        timezone: f.timezone || null,
        timezone_public: f.timezone_public || false,
        timezone_dst_enabled: f.timezone_dst_enabled ?? true,
      }));
    },
  });

  // POST /friends/:userId - Send friend request
  fastify.post('/:userId', {
    onRequest: [authenticate],
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const { userId: targetUserId } = request.params as { userId: string };
      const currentUserId = request.user!.id;

      // Cannot send friend request to yourself
      if (targetUserId === currentUserId) {
        return badRequest(reply, 'Cannot send friend request to yourself');
      }

      // Check if target user exists
      const targetUser = await db.users.findById(targetUserId);
      if (!targetUser) {
        return notFound(reply, 'User');
      }

      // Check if already friends
      if (await areFriends(currentUserId, targetUserId)) {
        return badRequest(reply, 'Already friends with this user');
      }

      // Check if either user has blocked the other
      if (await isBlocked(currentUserId, targetUserId)) {
        return forbidden(reply, 'Cannot send friend request to this user');
      }

      // Check if there's already a pending request from current user
      const existingOutgoing = await getPendingRequest(currentUserId, targetUserId);
      if (existingOutgoing) {
        return badRequest(reply, 'Friend request already pending');
      }

      // Check if there's a pending request from the target user (auto-accept scenario)
      const existingIncoming = await getPendingRequest(targetUserId, currentUserId);
      if (existingIncoming) {
        // Auto-accept: delete the request and create friendship
        await db.sql`DELETE FROM friend_requests WHERE id = ${existingIncoming.id}`;
        
        const [min, max] = currentUserId < targetUserId ? [currentUserId, targetUserId] : [targetUserId, currentUserId];
        const [friendship] = await db.sql`
          INSERT INTO friendships (user1_id, user2_id)
          VALUES (${min}, ${max})
          RETURNING *
        `;

        // Create DM channel automatically for the new friendship
        const existingDM = await db.dmChannels.findByUsers(currentUserId, targetUserId);
        if (!existingDM) {
          await db.dmChannels.create(currentUserId, targetUserId);
        }

        // Fetch current user's full profile for event payload
        const currentUserFull = await db.users.findById(currentUserId);

        // A5: Publish friend.request.accepted via event bus to both users
        await publishEvent({
          type: 'friend.request.accepted',
          actorId: currentUserId,
          resourceId: `user:${targetUserId}`,
          payload: {
            friend: {
              id: currentUserId,
              username: currentUserFull.username,
              display_name: currentUserFull.display_name || currentUserFull.username,
              avatar_url: currentUserFull.avatar_url || null,
              status: currentUserFull.status || 'online',
              since: friendship.created_at,
            },
          },
        });

        await publishEvent({
          type: 'friend.request.accepted',
          actorId: currentUserId,
          resourceId: `user:${currentUserId}`,
          payload: {
            friend: {
              id: targetUser.id,
              username: targetUser.username,
              display_name: targetUser.display_name || targetUser.username,
              avatar_url: targetUser.avatar_url || null,
              status: targetUser.status || 'online',
              since: friendship.created_at,
            },
          },
        });

        // A4/A5: Notify both users about the friendship
        await createNotification({
          userId: targetUserId,
          type: 'friend_accept',
          data: {
            user: {
              id: currentUserId,
              username: currentUserFull.username,
              avatar_url: currentUserFull.avatar_url || null,
            },
          },
        });
        await createNotification({
          userId: currentUserId,
          type: 'friend_accept',
          data: {
            user: {
              id: targetUser.id,
              username: targetUser.username,
              avatar_url: targetUser.avatar_url || null,
            },
          },
        });

        return reply.status(200).send({
          message: 'Friend request accepted (mutual request)',
          friend: {
            id: targetUser.id,
            username: targetUser.username,
            display_name: targetUser.display_name || targetUser.username,
            avatar_url: targetUser.avatar_url || null,
            status: targetUser.status || 'online',
            since: friendship.created_at,
          },
        });
      }

      // Create friend request
      const [friendRequest] = await db.sql`
        INSERT INTO friend_requests (from_user_id, to_user_id)
        VALUES (${currentUserId}, ${targetUserId})
        RETURNING *
      `;

      // Fetch current user full profile for notification data
      const currentUserFull = await db.users.findById(currentUserId);

      // A5: Publish friend.request.new via event bus for real-time delivery
      await publishEvent({
        type: 'friend.request.new',
        actorId: currentUserId,
        resourceId: `user:${targetUserId}`,
        payload: {
          request: {
            id: friendRequest.id,
            from_user: {
              id: currentUserId,
              username: currentUserFull?.username || request.user!.username,
              avatar_url: currentUserFull?.avatar_url || null,
            },
            created_at: friendRequest.created_at,
          },
        },
      });

      // A4/A5: Create a notification for the target user
      await createNotification({
        userId: targetUserId,
        type: 'friend_request',
        priority: 'high',
        data: {
          request_id: friendRequest.id,
          from_user: {
            id: currentUserId,
            username: currentUserFull?.username || request.user!.username,
            avatar_url: currentUserFull?.avatar_url || null,
          },
        },
      });

      return reply.status(201).send({
        message: 'Friend request sent',
        request: {
          id: friendRequest.id,
          to_user: {
            id: targetUser.id,
            username: targetUser.username,
            display_name: targetUser.username,
            avatar_url: targetUser.avatar_url,
          },
          created_at: friendRequest.created_at,
        },
      });
    },
  });

  // DELETE /friends/:userId - Remove friend or cancel request
  fastify.delete('/:userId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { userId: targetUserId } = request.params as { userId: string };
      const currentUserId = request.user!.id;

      // Try to delete friendship first
      const [min, max] = currentUserId < targetUserId ? [currentUserId, targetUserId] : [targetUserId, currentUserId];
      const deletedFriendship = await db.sql`
        DELETE FROM friendships 
        WHERE user1_id = ${min} AND user2_id = ${max}
        RETURNING *
      `;

      if (deletedFriendship.length > 0) {
        // A5: Publish friend.removed via event bus
        await publishEvent({
          type: 'friend.removed',
          actorId: currentUserId,
          resourceId: `user:${targetUserId}`,
          payload: { user_id: currentUserId },
        });

        // Also notify the actor so their other devices stay in sync
        await publishEvent({
          type: 'friend.removed',
          actorId: currentUserId,
          resourceId: `user:${currentUserId}`,
          payload: { user_id: targetUserId },
        });

        return { message: 'Friend removed' };
      }

      // Try to cancel outgoing friend request
      const deletedRequest = await db.sql`
        DELETE FROM friend_requests 
        WHERE from_user_id = ${currentUserId} AND to_user_id = ${targetUserId}
        RETURNING *
      `;

      if (deletedRequest.length > 0) {
        // A5: Notify target that the request was withdrawn
        await publishEvent({
          type: 'friend.request.declined',
          actorId: currentUserId,
          resourceId: `user:${targetUserId}`,
          payload: {
            request_id: deletedRequest[0].id,
            user_id: currentUserId,
            reason: 'cancelled',
          },
        });

        return { message: 'Friend request cancelled' };
      }

      // Try to reject incoming friend request
      const deletedIncoming = await db.sql`
        DELETE FROM friend_requests 
        WHERE from_user_id = ${targetUserId} AND to_user_id = ${currentUserId}
        RETURNING *
      `;

      if (deletedIncoming.length > 0) {
        // A5: Publish friend.request.declined via event bus
        await publishEvent({
          type: 'friend.request.declined',
          actorId: currentUserId,
          resourceId: `user:${targetUserId}`,
          payload: {
            request_id: deletedIncoming[0].id,
            user_id: currentUserId,
            reason: 'rejected',
          },
        });

        return { message: 'Friend request rejected' };
      }

      return notFound(reply, 'Friendship or friend request');
    },
  });

  // GET /friends/requests - List pending friend requests
  fastify.get('/requests', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const userId = request.user!.id;

      // Get incoming requests (sent TO current user)
      const incoming = await db.sql`
        SELECT 
          fr.id,
          fr.created_at,
          u.id as from_user_id,
          u.username as from_user_username,
          u.avatar_url as from_user_avatar_url
        FROM friend_requests fr
        JOIN users u ON fr.from_user_id = u.id
        WHERE fr.to_user_id = ${userId}
        ORDER BY fr.created_at DESC
      `;

      // Get outgoing requests (sent BY current user)
      const outgoing = await db.sql`
        SELECT 
          fr.id,
          fr.created_at,
          u.id as to_user_id,
          u.username as to_user_username,
          u.avatar_url as to_user_avatar_url
        FROM friend_requests fr
        JOIN users u ON fr.to_user_id = u.id
        WHERE fr.from_user_id = ${userId}
        ORDER BY fr.created_at DESC
      `;

      return {
        incoming: incoming.map((r: any) => ({
          id: r.id,
          from_user: {
            id: r.from_user_id,
            username: r.from_user_username,
            display_name: r.from_user_username,
            avatar_url: r.from_user_avatar_url,
          },
          created_at: r.created_at,
        })),
        outgoing: outgoing.map((r: any) => ({
          id: r.id,
          to_user: {
            id: r.to_user_id,
            username: r.to_user_username,
            display_name: r.to_user_username,
            avatar_url: r.to_user_avatar_url,
          },
          created_at: r.created_at,
        })),
      };
    },
  });

  // POST /friends/requests/:userId/accept - Accept friend request
  fastify.post('/requests/:userId/accept', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { userId: fromUserId } = request.params as { userId: string };
      const currentUserId = request.user!.id;

      // Find the pending request
      const pendingRequest = await getPendingRequest(fromUserId, currentUserId);
      if (!pendingRequest) {
        return notFound(reply, 'No pending friend request from this user');
      }

      // Delete the request
      await db.sql`DELETE FROM friend_requests WHERE id = ${pendingRequest.id}`;

      // Create the friendship
      const [min, max] = currentUserId < fromUserId ? [currentUserId, fromUserId] : [fromUserId, currentUserId];
      const [friendship] = await db.sql`
        INSERT INTO friendships (user1_id, user2_id)
        VALUES (${min}, ${max})
        RETURNING *
      `;

      // Create DM channel automatically for the new friendship
      const existingDM = await db.dmChannels.findByUsers(currentUserId, fromUserId);
      if (!existingDM) {
        await db.dmChannels.create(currentUserId, fromUserId);
      }

      // Get both users' full info
      const friend = await db.users.findById(fromUserId);
      const currentUserFull = await db.users.findById(currentUserId);

      // A5: Publish friend.request.accepted via event bus to both users
      await publishEvent({
        type: 'friend.request.accepted',
        actorId: currentUserId,
        resourceId: `user:${fromUserId}`,
        payload: {
          friend: {
            id: currentUserId,
            username: currentUserFull.username,
            display_name: currentUserFull.display_name || currentUserFull.username,
            avatar_url: currentUserFull.avatar_url || null,
            status: currentUserFull.status || 'online',
            since: friendship.created_at,
          },
        },
      });

      await publishEvent({
        type: 'friend.request.accepted',
        actorId: currentUserId,
        resourceId: `user:${currentUserId}`,
        payload: {
          friend: {
            id: friend.id,
            username: friend.username,
            display_name: friend.display_name || friend.username,
            avatar_url: friend.avatar_url || null,
            status: friend.status || 'online',
            since: friendship.created_at,
          },
        },
      });

      // A4/A5: Notify the original requester that their request was accepted
      await createNotification({
        userId: fromUserId,
        type: 'friend_accept',
        data: {
          user: {
            id: currentUserId,
            username: currentUserFull.username,
            avatar_url: currentUserFull.avatar_url || null,
          },
        },
      });

      return {
        message: 'Friend request accepted',
        friend: {
          id: friend.id,
          username: friend.username,
          display_name: friend.display_name || friend.username,
          avatar_url: friend.avatar_url || null,
          status: friend.status || 'online',
          since: friendship.created_at,
        },
      };
    },
  });

  // POST /friends/requests/:userId/reject - Reject friend request
  fastify.post('/requests/:userId/reject', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { userId: fromUserId } = request.params as { userId: string };
      const currentUserId = request.user!.id;

      // Find and delete the pending request
      const deleted = await db.sql`
        DELETE FROM friend_requests 
        WHERE from_user_id = ${fromUserId} AND to_user_id = ${currentUserId}
        RETURNING *
      `;

      if (deleted.length === 0) {
        return notFound(reply, 'No pending friend request from this user');
      }

      // A5: Publish friend.request.declined via event bus
      await publishEvent({
        type: 'friend.request.declined',
        actorId: currentUserId,
        resourceId: `user:${fromUserId}`,
        payload: {
          request_id: deleted[0].id,
          user_id: currentUserId,
          reason: 'rejected',
        },
      });

      return { message: 'Friend request rejected' };
    },
  });
};
