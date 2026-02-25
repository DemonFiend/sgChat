import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { publishEvent } from '../lib/eventBus.js';
import { calculatePermissions } from '../services/permissions.js';
import { generateLiveKitToken, getLiveKitUrl } from '../services/livekit.js';
import { VoicePermissions, hasPermission, RATE_LIMITS } from '@sgchat/shared';
import { notFound, forbidden, badRequest } from '../utils/errors.js';
import { 
  createTempVoiceChannel, 
  markTempChannelEmpty, 
  markTempChannelOccupied,
  isTempVoiceGenerator 
} from '../services/tempChannels.js';

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

      let channel = await db.channels.findById(channel_id);
      if (!channel) {
        return notFound(reply, 'Voice channel');
      }

      // Handle temp voice generator - create temp channel and redirect
      if (channel.type === 'temp_voice_generator') {
        const perms = await calculatePermissions(request.user!.id, channel.server_id, channel_id);
        if (!hasPermission(perms.voice, VoicePermissions.CONNECT)) {
          return forbidden(reply, 'You don\'t have permission to create a temp channel');
        }

        const { channelId: tempChannelId, channelName } = await createTempVoiceChannel(
          request.user!.id,
          channel_id
        );

        // Redirect to the temp channel
        channel = await db.channels.findById(tempChannelId);
        if (!channel) {
          return badRequest(reply, 'Failed to create temp channel');
        }
      }

      if (channel.type !== 'voice' && channel.type !== 'music' && channel.type !== 'temp_voice') {
        return badRequest(reply, 'Not a voice channel');
      }

      // Check permissions
      const perms = await calculatePermissions(request.user!.id, channel.server_id, channel.id);

      if (!hasPermission(perms.voice, VoicePermissions.CONNECT)) {
        return forbidden(reply, 'You don\'t have permission to join this voice channel');
      }

      // Mark temp channel as occupied
      if (channel.is_temp_channel) {
        await markTempChannelOccupied(channel.id);
      }

      const roomName = `voice:${channel.id}`;

      // For music/stage channels, default to listener mode unless user has SPEAK permission
      const isStageChannel = channel.type === 'music';
      const canSpeak = hasPermission(perms.voice, VoicePermissions.SPEAK);

      // Generate LiveKit token with appropriate grants
      const token = await generateLiveKitToken({
        identity: request.user!.id,
        room: roomName,
        canPublish: isStageChannel ? canSpeak : hasPermission(perms.voice, VoicePermissions.SPEAK),
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

      let channel = await db.channels.findById(channelId);
      let actualChannelId = channelId;

      if (!channel) {
        return notFound(reply, 'Channel');
      }

      // Handle temp voice generator - create temp channel and redirect
      if (channel.type === 'temp_voice_generator') {
        const perms = await calculatePermissions(request.user!.id, channel.server_id, channelId);
        if (!hasPermission(perms.voice, VoicePermissions.CONNECT)) {
          return forbidden(reply, 'You don\'t have permission to create a temp channel');
        }

        const { channelId: tempChannelId, channelName } = await createTempVoiceChannel(
          request.user!.id,
          channelId
        );

        // Use the temp channel instead
        channel = await db.channels.findById(tempChannelId);
        actualChannelId = tempChannelId;
        
        if (!channel) {
          return badRequest(reply, 'Failed to create temp channel');
        }
      }

      if (channel.type !== 'voice' && channel.type !== 'music' && channel.type !== 'temp_voice') {
        return badRequest(reply, 'Not a voice channel');
      }

      // Check permissions
      const perms = await calculatePermissions(request.user!.id, channel.server_id, actualChannelId);

      if (!hasPermission(perms.voice, VoicePermissions.CONNECT)) {
        return forbidden(reply, 'Missing CONNECT permission');
      }

      // Mark temp channel as occupied
      if (channel.is_temp_channel) {
        await markTempChannelOccupied(actualChannelId);
      }

      // Enforce user limit (0 = unlimited)
      if (channel.user_limit && channel.user_limit > 0) {
        const participants = await redis.getVoiceChannelParticipants(actualChannelId);
        if (participants.length >= channel.user_limit && !hasPermission(perms.voice, VoicePermissions.MOVE_MEMBERS)) {
          return badRequest(reply, 'Voice channel is full');
        }
      }

      // For music/stage channels, default to listener mode unless user has SPEAK permission
      const isStageChannel = channel.type === 'music';
      const canSpeak = hasPermission(perms.voice, VoicePermissions.SPEAK);

      // Generate LiveKit token with appropriate grants
      const token = await generateLiveKitToken({
        identity: request.user!.id,
        room: `voice:${actualChannelId}`,
        canPublish: isStageChannel ? canSpeak : hasPermission(perms.voice, VoicePermissions.SPEAK),
        canPublishVideo: hasPermission(perms.voice, VoicePermissions.VIDEO),
        canPublishScreen: hasPermission(perms.voice, VoicePermissions.STREAM),
        canSubscribe: true, // Can always listen
      });

      // Track voice state in Redis
      await redis.joinVoiceChannel(request.user!.id, actualChannelId);

      // Get user info for socket event
      const user = await db.users.findById(request.user!.id);

      // Publish voice.join event through event bus
      await publishEvent({
        type: 'voice.join',
        actorId: request.user!.id,
        resourceId: `server:${channel.server_id}`,
        payload: {
          channel_id: actualChannelId,
          user: {
            id: user.id,
            username: user.username,
            display_name: user.display_name || user.username,
            avatar_url: user.avatar_url,
          },
          is_temp_channel: channel.is_temp_channel || false,
          redirected_from: channelId !== actualChannelId ? channelId : undefined,
        },
      });

      return {
        token,
        url: getLiveKitUrl(),
        room_name: `voice:${actualChannelId}`,
        channel_id: actualChannelId,
        is_temp_channel: channel.is_temp_channel || false,
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

  // Leave voice channel
  fastify.post('/leave/:channelId', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { channelId } = request.params as { channelId: string };

      const channel = await db.channels.findById(channelId);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      // Remove from Redis voice state
      await redis.leaveVoiceChannel(request.user!.id);

      // Get user info for socket event
      const user = await db.users.findById(request.user!.id);

      // Publish voice.leave event
      await publishEvent({
        type: 'voice.leave',
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

      // Check if temp channel is now empty
      if (channel.is_temp_channel) {
        const participants = await redis.getVoiceChannelParticipants(channelId);
        if (participants.length === 0) {
          await markTempChannelEmpty(channelId);
          console.log(`🕐 Temp channel ${channel.name} is now empty, starting cleanup timer`);
        }
      }

      return { message: 'Left voice channel' };
    },
  });

  // Get temp channel settings (admin)
  fastify.get('/temp-settings', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const { getTempChannelSettings } = await import('../services/tempChannels.js');
      const settings = await getTempChannelSettings();
      return settings;
    },
  });

  // Update temp channel settings (admin)
  fastify.patch('/temp-settings', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const updates = request.body as any;

      // TODO: Check admin permissions

      const { updateTempChannelSettings } = await import('../services/tempChannels.js');
      const settings = await updateTempChannelSettings(updates);
      return settings;
    },
  });

  // Manually cleanup empty temp channels (admin)
  fastify.post('/cleanup-temp-channels', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      // TODO: Check admin permissions

      const { cleanupEmptyTempChannels } = await import('../services/tempChannels.js');
      const result = await cleanupEmptyTempChannels();
      return result;
    },
  });
};
