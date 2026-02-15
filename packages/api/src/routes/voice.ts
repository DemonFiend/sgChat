import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { publishEvent } from '../lib/eventBus.js';
import { calculatePermissions } from '../services/permissions.js';
import { generateLiveKitToken, getLiveKitUrl } from '../services/livekit.js';
import { VoicePermissions, hasPermission, RATE_LIMITS } from '@sgchat/shared';
import { notFound, forbidden, badRequest } from '../utils/errors.js';

export const voiceRoutes: FastifyPluginAsync = async (fastify) => {
  // Get voice token for a channel (GET endpoint as specified in SERVER_HANDOFF.md)
  fastify.get('/token', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: RATE_LIMITS.VOICE_JOIN.max,
        timeWindow: `${RATE_LIMITS.VOICE_JOIN.window} seconds`,
      },
    },
    handler: async (request, reply) => {
      const { channel_id } = request.query as { channel_id: string };
      
      if (!channel_id) {
        return badRequest(reply, 'channel_id is required');
      }

      const channel = await db.channels.findById(channel_id);
      if (!channel) {
        return notFound(reply, 'Voice channel');
      }

      if (channel.type !== 'voice') {
        return badRequest(reply, 'Not a voice channel');
      }

      // Check permissions
      const perms = await calculatePermissions(request.user!.id, channel.server_id, channel_id);
      
      if (!hasPermission(perms.voice, VoicePermissions.CONNECT)) {
        return forbidden(reply, 'You don\'t have permission to join this voice channel');
      }

      const roomName = `voice:${channel_id}`;

      // Generate LiveKit token with appropriate grants
      const token = await generateLiveKitToken({
        identity: request.user!.id,
        room: roomName,
        canPublish: hasPermission(perms.voice, VoicePermissions.SPEAK),
        canPublishVideo: hasPermission(perms.voice, VoicePermissions.VIDEO),
        canPublishScreen: hasPermission(perms.voice, VoicePermissions.STREAM),
        canSubscribe: true,
      });

      // Track voice state in Redis
      await redis.joinVoiceChannel(request.user!.id, channel_id);

      // Get user info for socket event
      const user = await db.users.findById(request.user!.id);

      // Publish voice.join event through event bus
      await publishEvent({
        type: 'voice.join',
        actorId: request.user!.id,
        resourceId: `server:${channel.server_id}`,
        payload: {
          channel_id,
          user: {
            id: user.id,
            username: user.username,
            display_name: user.display_name || user.username,
            avatar_url: user.avatar_url,
          },
        },
      });

      return {
        token,
        url: getLiveKitUrl(),
        room_name: roomName,
      };
    },
  });

  // Join voice channel (get LiveKit token) - POST version
  fastify.post('/join/:channelId', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: RATE_LIMITS.VOICE_JOIN.max,
        timeWindow: `${RATE_LIMITS.VOICE_JOIN.window} seconds`,
      },
    },
    handler: async (request, reply) => {
      const { channelId } = request.params as { channelId: string };
      
      const channel = await db.channels.findById(channelId);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      if (channel.type !== 'voice') {
        return badRequest(reply, 'Not a voice channel');
      }

      // Check permissions
      const perms = await calculatePermissions(request.user!.id, channel.server_id, channelId);
      
      if (!hasPermission(perms.voice, VoicePermissions.CONNECT)) {
        return forbidden(reply, 'Missing CONNECT permission');
      }

      // Enforce user limit (0 = unlimited)
      if (channel.user_limit && channel.user_limit > 0) {
        const participants = await redis.getVoiceChannelParticipants(channelId);
        // Admins/move_members can bypass the limit
        if (participants.length >= channel.user_limit && !hasPermission(perms.voice, VoicePermissions.MOVE_MEMBERS)) {
          return badRequest(reply, 'Voice channel is full');
        }
      }

      // Generate LiveKit token with appropriate grants
      const token = await generateLiveKitToken({
        identity: request.user!.id,
        room: `voice:${channelId}`,
        canPublish: hasPermission(perms.voice, VoicePermissions.SPEAK),
        canPublishVideo: hasPermission(perms.voice, VoicePermissions.VIDEO),
        canPublishScreen: hasPermission(perms.voice, VoicePermissions.STREAM),
        canSubscribe: true, // Can always listen
      });

      // Track voice state in Redis
      await redis.joinVoiceChannel(request.user!.id, channelId);

      // Get user info for socket event
      const user = await db.users.findById(request.user!.id);

      // Publish voice.join event through event bus
      await publishEvent({
        type: 'voice.join',
        actorId: request.user!.id,
        resourceId: `server:${channel.server_id}`,
        payload: {
          channel_id: channelId,
          user: {
            id: user.id,
            username: user.username,
            display_name: user.display_name || user.username,
            avatar_url: user.avatar_url,
          },
        },
      });

      return {
        token,
        url: getLiveKitUrl(),
        room_name: `voice:${channelId}`,
        bitrate: channel.bitrate || 64000,
        user_limit: channel.user_limit || 0,
        permissions: {
          canSpeak: hasPermission(perms.voice, VoicePermissions.SPEAK),
          canVideo: hasPermission(perms.voice, VoicePermissions.VIDEO),
          canStream: hasPermission(perms.voice, VoicePermissions.STREAM),
          canMuteMembers: hasPermission(perms.voice, VoicePermissions.MUTE_MEMBERS),
          canMoveMembers: hasPermission(perms.voice, VoicePermissions.MOVE_MEMBERS),
          canDisconnectMembers: hasPermission(perms.voice, VoicePermissions.DISCONNECT_MEMBERS),
          canDeafenMembers: hasPermission(perms.voice, VoicePermissions.DEAFEN_MEMBERS),
        },
      };
    },
  });

  // Move to AFK channel
  fastify.post('/move-to-afk', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: RATE_LIMITS.VOICE_JOIN.max,
        timeWindow: `${RATE_LIMITS.VOICE_JOIN.window} seconds`,
      },
    },
    handler: async (request, reply) => {
      const { server_id } = request.body as { server_id: string };
      
      const server = await db.servers.findById(server_id);
      if (!server) {
        return notFound(reply, 'Server');
      }
      if (!server.afk_channel_id) {
        return badRequest(reply, 'Server has no AFK channel configured');
      }

      // Generate token for AFK channel (will be muted automatically)
      const token = await generateLiveKitToken({
        identity: request.user!.id,
        room: `voice:${server.afk_channel_id}`,
        canPublish: false, // Muted in AFK
        canPublishVideo: false,
        canPublishScreen: false,
        canSubscribe: true,
      });

      return {
        token,
        url: getLiveKitUrl(),
        afk_channel_id: server.afk_channel_id,
      };
    },
  });

  // Move member (moderator action)
  fastify.post('/move-member', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: RATE_LIMITS.VOICE_JOIN.max,
        timeWindow: `${RATE_LIMITS.VOICE_JOIN.window} seconds`,
      },
    },
    handler: async (request, reply) => {
      const { user_id, from_channel_id, to_channel_id } = request.body as {
        user_id: string;
        from_channel_id: string;
        to_channel_id: string;
      };

      const fromChannel = await db.channels.findById(from_channel_id);
      if (!fromChannel) {
        return notFound(reply, 'Source channel');
      }
      const perms = await calculatePermissions(request.user!.id, fromChannel.server_id);
      
      if (!hasPermission(perms.voice, VoicePermissions.MOVE_MEMBERS)) {
        return forbidden(reply, 'Missing MOVE_MEMBERS permission');
      }

      // Notify user via event bus to switch channels
      await publishEvent({
        type: 'voice.force_move',
        actorId: request.user!.id,
        resourceId: `user:${user_id}`,
        payload: {
          from_channel_id,
          to_channel_id,
          moved_by: request.user!.id,
        },
      });

      return { message: 'Move requested' };
    },
  });

  // Disconnect member (moderator action)
  fastify.post('/disconnect-member', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: RATE_LIMITS.VOICE_JOIN.max,
        timeWindow: `${RATE_LIMITS.VOICE_JOIN.window} seconds`,
      },
    },
    handler: async (request, reply) => {
      const { user_id, channel_id } = request.body as {
        user_id: string;
        channel_id: string;
      };

      const channel = await db.channels.findById(channel_id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }
      const perms = await calculatePermissions(request.user!.id, channel.server_id);
      
      if (!hasPermission(perms.voice, VoicePermissions.DISCONNECT_MEMBERS)) {
        return forbidden(reply, 'Missing DISCONNECT_MEMBERS permission');
      }

      // Notify user via event bus to disconnect
      await publishEvent({
        type: 'voice.force_disconnect',
        actorId: request.user!.id,
        resourceId: `user:${user_id}`,
        payload: {
          channel_id,
          disconnected_by: request.user!.id,
        },
      });

      return { message: 'Disconnect requested' };
    },
  });
};
