import { Server as SocketIOServer, Socket } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { calculatePermissions } from '../services/permissions.js';
import { TextPermissions, hasPermission } from '@sgchat/shared';

export function initSocketIO(io: SocketIOServer, fastify: FastifyInstance) {
  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = fastify.jwt.verify(token) as any;
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId = socket.data.user.id;
    fastify.log.info(`Socket connected: ${socket.data.user.username} (${userId})`);

    // Join user's personal room
    socket.join(`user:${userId}`);

    // Join all server rooms user is a member of
    const servers = await db.servers.findByUserId(userId);
    for (const server of servers) {
      socket.join(`server:${server.id}`);
      
      // Join all channel rooms in this server
      const channels = await db.channels.findByServerId(server.id);
      for (const channel of channels) {
        socket.join(`channel:${channel.id}`);
      }
    }

    // Join DM rooms
    const dmChannels = await db.dmChannels.findByUserId(userId);
    for (const dm of dmChannels) {
      socket.join(`dm:${dm.id}`);
    }

    // Set user online
    await db.users.updateStatus(userId, 'active');
    await redis.setPresence(userId, true);

    // Broadcast online status to all servers
    for (const server of servers) {
      io.to(`server:${server.id}`).emit('presence:update', {
        user_id: userId,
        status: 'active',
        last_seen_at: new Date().toISOString(),
      });
    }

    // --- Message Events ---

    socket.on('message:send', async (data: {
      channel_id: string;
      content: string;
      reply_to_id?: string;
    }) => {
      try {
        const channel = await db.channels.findById(data.channel_id);
        if (!channel) return;

        // Check permissions
        const perms = await calculatePermissions(userId, channel.server_id, data.channel_id);
        if (!hasPermission(perms.text, TextPermissions.SEND_MESSAGES)) {
          socket.emit('error', { message: 'Missing SEND_MESSAGES permission' });
          return;
        }

        // Create message
        const message = await db.messages.create({
          channel_id: data.channel_id,
          author_id: userId,
          content: data.content,
          reply_to_id: data.reply_to_id,
          status: 'sent',
        });

        // Broadcast to channel
        io.to(`channel:${data.channel_id}`).emit('message:new', message);
      } catch (err) {
        fastify.log.error(err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    socket.on('message:edit', async (data: {
      message_id: string;
      content: string;
    }) => {
      try {
        const message = await db.messages.findById(data.message_id);
        if (!message || message.author_id !== userId) {
          socket.emit('error', { message: 'Cannot edit this message' });
          return;
        }

        const updated = await db.messages.update(data.message_id, {
          content: data.content,
          edited_at: new Date(),
        });

        // Broadcast to channel
        const room = message.channel_id ? `channel:${message.channel_id}` : `dm:${message.dm_channel_id}`;
        io.to(room).emit('message:edit', updated);
      } catch (err) {
        fastify.log.error(err);
        socket.emit('error', { message: 'Failed to edit message' });
      }
    });

    socket.on('message:delete', async (data: { message_id: string }) => {
      try {
        const message = await db.messages.findById(data.message_id);
        if (!message) return;

        // Check ownership or MANAGE_MESSAGES permission
        let canDelete = message.author_id === userId;
        if (!canDelete && message.channel_id) {
          const channel = await db.channels.findById(message.channel_id);
          const perms = await calculatePermissions(userId, channel.server_id, message.channel_id);
          canDelete = hasPermission(perms.text, TextPermissions.MANAGE_MESSAGES);
        }

        if (!canDelete) {
          socket.emit('error', { message: 'Cannot delete this message' });
          return;
        }

        await db.messages.delete(data.message_id);

        // Broadcast to channel
        const room = message.channel_id ? `channel:${message.channel_id}` : `dm:${message.dm_channel_id}`;
        io.to(room).emit('message:delete', { id: data.message_id });
      } catch (err) {
        fastify.log.error(err);
        socket.emit('error', { message: 'Failed to delete message' });
      }
    });

    // --- Typing Indicators ---

    const typingTimeouts = new Map<string, NodeJS.Timeout>();

    socket.on('typing:start', async (data: { channel_id: string }) => {
      const key = `${userId}:${data.channel_id}`;
      
      // Clear existing timeout
      if (typingTimeouts.has(key)) {
        clearTimeout(typingTimeouts.get(key)!);
      }

      // Broadcast typing
      socket.to(`channel:${data.channel_id}`).emit('typing:start', {
        user_id: userId,
        channel_id: data.channel_id,
      });

      // Auto-stop after 5 seconds
      const timeout = setTimeout(() => {
        socket.to(`channel:${data.channel_id}`).emit('typing:stop', {
          user_id: userId,
          channel_id: data.channel_id,
        });
        typingTimeouts.delete(key);
      }, 5000);

      typingTimeouts.set(key, timeout);
    });

    socket.on('typing:stop', (data: { channel_id: string }) => {
      const key = `${userId}:${data.channel_id}`;
      
      if (typingTimeouts.has(key)) {
        clearTimeout(typingTimeouts.get(key)!);
        typingTimeouts.delete(key);
      }

      socket.to(`channel:${data.channel_id}`).emit('typing:stop', {
        user_id: userId,
        channel_id: data.channel_id,
      });
    });

    // --- Presence Updates ---

    socket.on('presence:update', async (data: { status: string }) => {
      await db.users.updateStatus(userId, data.status as any);
      
      // Broadcast to all servers
      for (const server of servers) {
        io.to(`server:${server.id}`).emit('presence:update', {
          user_id: userId,
          status: data.status,
        });
      }
    });

    // --- Voice State ---

    socket.on('voice:join', async (data: {
      channel_id: string;
      muted?: boolean;
      deafened?: boolean;
    }) => {
      const channel = await db.channels.findById(data.channel_id);
      if (!channel) return;

      // Store voice state in Redis
      await redis.client.set(
        `voice:${userId}`,
        JSON.stringify({
          channel_id: data.channel_id,
          server_id: channel.server_id,
          muted: data.muted || false,
          deafened: data.deafened || false,
          joined_at: new Date().toISOString(),
        }),
        'EX',
        3600 // 1 hour expiry
      );

      // Broadcast to server
      io.to(`server:${channel.server_id}`).emit('voice:state', {
        user_id: userId,
        channel_id: data.channel_id,
        muted: data.muted,
        deafened: data.deafened,
      });
    });

    socket.on('voice:leave', async () => {
      const voiceState = await redis.client.get(`voice:${userId}`);
      if (!voiceState) return;

      const state = JSON.parse(voiceState);
      await redis.client.del(`voice:${userId}`);

      // Broadcast to server
      io.to(`server:${state.server_id}`).emit('voice:state', {
        user_id: userId,
        channel_id: null,
      });
    });

    socket.on('voice:update', async (data: { muted?: boolean; deafened?: boolean }) => {
      const voiceState = await redis.client.get(`voice:${userId}`);
      if (!voiceState) return;

      const state = JSON.parse(voiceState);
      state.muted = data.muted ?? state.muted;
      state.deafened = data.deafened ?? state.deafened;

      await redis.client.set(`voice:${userId}`, JSON.stringify(state), 'EX', 3600);

      // Broadcast to server
      io.to(`server:${state.server_id}`).emit('voice:state', {
        user_id: userId,
        channel_id: state.channel_id,
        muted: state.muted,
        deafened: state.deafened,
      });
    });

    // --- DM Events ---

    socket.on('dm:send', async (data: {
      dm_channel_id: string;
      content: string;
      reply_to_id?: string;
    }) => {
      try {
        const dmChannel = await db.dmChannels.findById(data.dm_channel_id);
        if (!dmChannel) return;

        // Verify user is participant
        if (dmChannel.user1_id !== userId && dmChannel.user2_id !== userId) {
          socket.emit('error', { message: 'Not a participant' });
          return;
        }

        const message = await db.messages.create({
          dm_channel_id: data.dm_channel_id,
          author_id: userId,
          content: data.content,
          reply_to_id: data.reply_to_id,
          status: 'sent',
        });

        // Broadcast to both users
        io.to(`dm:${data.dm_channel_id}`).emit('message:new', message);

        // Send push notification if recipient offline
        const recipientId = dmChannel.user1_id === userId ? dmChannel.user2_id : dmChannel.user1_id;
        const isOnline = await redis.getPresence(recipientId);
        
        if (!isOnline) {
          // TODO: Send push notification via ntfy
          fastify.log.info(`Would send push notification to ${recipientId}`);
        }
      } catch (err) {
        fastify.log.error(err);
        socket.emit('error', { message: 'Failed to send DM' });
      }
    });

    socket.on('dm:ack', async (data: { message_ids: string[] }) => {
      try {
        for (const messageId of data.message_ids) {
          await db.messages.updateStatus(messageId, 'received', new Date());
          
          const message = await db.messages.findById(messageId);
          if (message) {
            // Notify sender
            io.to(`user:${message.author_id}`).emit('message:status', {
              id: messageId,
              status: 'received',
              received_at: new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        fastify.log.error(err);
      }
    });

    // --- Disconnect ---

    socket.on('disconnect', async () => {
      fastify.log.info(`Socket disconnected: ${socket.data.user.username}`);

      // Clean up typing indicators
      for (const timeout of typingTimeouts.values()) {
        clearTimeout(timeout);
      }
      typingTimeouts.clear();

      // Set user offline
      await db.users.updateStatus(userId, 'offline');
      await redis.setPresence(userId, false);

      // Clear voice state
      await redis.client.del(`voice:${userId}`);

      // Broadcast offline status
      for (const server of servers) {
        io.to(`server:${server.id}`).emit('presence:update', {
          user_id: userId,
          status: 'offline',
          last_seen_at: new Date().toISOString(),
        });
      }
    });
  });

  return io;
}
