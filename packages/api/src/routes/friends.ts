import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
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
      const friends = await db.sql`
        SELECT 
          u.id,
          u.username,
          u.avatar_url,
          u.status,
          u.custom_status_emoji,
          u.custom_status,
          u.last_seen_at,
          f.created_at as since
        FROM friendships f
        JOIN users u ON (
          CASE 
            WHEN f.user1_id = ${userId} THEN f.user2_id = u.id
            ELSE f.user1_id = u.id
          END
        )
        WHERE f.user1_id = ${userId} OR f.user2_id = ${userId}
        ORDER BY 
          CASE u.status 
            WHEN 'active' THEN 1 
            WHEN 'idle' THEN 2 
            WHEN 'busy' THEN 3
            WHEN 'dnd' THEN 4
            WHEN 'invisible' THEN 5
            ELSE 6 
          END,
          u.username ASC
      `;

      return friends.map((f: any) => ({
        id: f.id,
        username: f.username,
        display_name: f.username, // Use username as display_name for now
        avatar_url: f.avatar_url,
        status: f.status,
        since: f.since,
        last_seen_at: f.last_seen_at || null,
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

        // Fetch current user's full profile for socket event
        const currentUserFull = await db.users.findById(currentUserId);

        // Notify both users via socket
        fastify.io?.to(`user:${targetUserId}`).emit('friend:accept', {
          friend: {
            id: currentUserId,
            username: currentUserFull.username,
            display_name: currentUserFull.display_name || currentUserFull.username,
            avatar_url: currentUserFull.avatar_url || null,
            status: currentUserFull.status || 'online',
            since: friendship.created_at,
          },
        });

        fastify.io?.to(`user:${currentUserId}`).emit('friend:accept', {
          friend: {
            id: targetUser.id,
            username: targetUser.username,
            display_name: targetUser.display_name || targetUser.username,
            avatar_url: targetUser.avatar_url || null,
            status: targetUser.status || 'online',
            since: friendship.created_at,
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

      // Notify target user via socket
      fastify.io?.to(`user:${targetUserId}`).emit('friend:request', {
        request: {
          id: friendRequest.id,
          from_user: {
            id: currentUserId,
            username: request.user!.username,
            avatar_url: null, // Would need to fetch
          },
          created_at: friendRequest.created_at,
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
        // Notify the other user
        fastify.io?.to(`user:${targetUserId}`).emit('friend:remove', {
          user_id: currentUserId,
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
        return { message: 'Friend request cancelled' };
      }

      // Try to reject incoming friend request
      const deletedIncoming = await db.sql`
        DELETE FROM friend_requests 
        WHERE from_user_id = ${targetUserId} AND to_user_id = ${currentUserId}
        RETURNING *
      `;

      if (deletedIncoming.length > 0) {
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

      // Get both users' full info
      const friend = await db.users.findById(fromUserId);
      const currentUserFull = await db.users.findById(currentUserId);

      // Notify the requester
      fastify.io?.to(`user:${fromUserId}`).emit('friend:accept', {
        friend: {
          id: currentUserId,
          username: currentUserFull.username,
          display_name: currentUserFull.display_name || currentUserFull.username,
          avatar_url: currentUserFull.avatar_url || null,
          status: currentUserFull.status || 'online',
          since: friendship.created_at,
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

      return { message: 'Friend request rejected' };
    },
  });
};
