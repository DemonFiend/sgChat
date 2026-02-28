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
import { scheduleTempChannelCreation, cancelPendingCreation } from '../services/tempChannelTimers.js';

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
      let actualChannelId = channel_id;
      let isTempRedirect = false;

      if (!channel) {
        return notFound(reply, 'Voice channel');
      }

      // Handle temp voice generator - join generator with 5s delay before creating temp channel
      if (channel.type === 'temp_voice_generator') {
        const perms = await calculatePermissions(request.user!.id, channel.server_id, channel_id);
        if (!hasPermission(perms.voice, VoicePermissions.CONNECT)) {
          return forbidden(reply, 'You don\'t have permission to create a temp channel');
        }

        // Join the generator channel itself (user will be auto-moved after 5s)
        const token = await generateLiveKitToken({
          identity: request.user!.id,
          room: `voice:${channel_id}`,
          canPublish: hasPermission(perms.voice, VoicePermissions.SPEAK),
          canPublishVideo: false,
          canPublishScreen: false,
          canSubscribe: true,
        });

        await redis.joinVoiceChannel(request.user!.id, channel_id);

        // Schedule temp channel creation after 5 seconds
        scheduleTempChannelCreation(request.user!.id, channel_id, channel.server_id);

        // Get user info for socket event
        const user = await db.users.findById(request.user!.id);

        // Check for custom join sound
        const customJoinSound = await db.userVoiceSounds.findByUserServerType(request.user!.id, channel.server_id, 'join');

        await publishEvent({
          type: 'voice.join',
          actorId: request.user!.id,
          resourceId: `server:${channel.server_id}`,
          payload: {
            channel_id: channel_id,
            user: {
              id: user.id,
              username: user.username,
              display_name: user.display_name || user.username,
              avatar_url: user.avatar_url,
            },
            is_temp_channel: false,
            custom_sound_url: customJoinSound?.sound_url || null,
          },
        });

        return {
          token,
          url: getLiveKitUrl(),
          room_name: `voice:${channel_id}`,
          channel_id: channel_id,
          is_temp_channel: false,
          is_temp_generator: true,
        };
      }

      if (channel.type !== 'voice' && channel.type !== 'music' && channel.type !== 'temp_voice') {
        return badRequest(reply, 'Not a voice channel');
      }

      // Check permissions
      const perms = await calculatePermissions(request.user!.id, channel.server_id, actualChannelId);

      if (!hasPermission(perms.voice, VoicePermissions.CONNECT)) {
        return forbidden(reply, 'You don\'t have permission to join this voice channel');
      }

      // Mark temp channel as occupied
      if (channel.is_temp_channel) {
        await markTempChannelOccupied(actualChannelId);
      }

      const roomName = `voice:${actualChannelId}`;

      // For music/stage channels, default to listener mode unless user has SPEAK permission
      const isStageChannel = channel.type === 'music';
      const isAfkChannel = channel.is_afk_channel === true;
      const canSpeak = hasPermission(perms.voice, VoicePermissions.SPEAK);

      // Generate LiveKit token with appropriate grants
      // AFK channel: no publish/subscribe — full silence, no audio in or out
      const token = await generateLiveKitToken({
        identity: request.user!.id,
        room: roomName,
        canPublish: isAfkChannel ? false : isStageChannel ? canSpeak : hasPermission(perms.voice, VoicePermissions.SPEAK),
        canPublishVideo: isAfkChannel ? false : hasPermission(perms.voice, VoicePermissions.VIDEO),
        canPublishScreen: isAfkChannel ? false : hasPermission(perms.voice, VoicePermissions.STREAM),
        canSubscribe: !isAfkChannel,
      });

      // Track voice state in Redis
      await redis.joinVoiceChannel(request.user!.id, actualChannelId);

      // Get user info for socket event
      const user = await db.users.findById(request.user!.id);

      // Check for custom join sound
      const customJoinSound = await db.userVoiceSounds.findByUserServerType(request.user!.id, channel.server_id, 'join');

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
          custom_sound_url: customJoinSound?.sound_url || null,
        },
      });

      return {
        token,
        url: getLiveKitUrl(),
        room_name: roomName,
        channel_id: actualChannelId,
        is_temp_channel: channel.is_temp_channel || false,
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

      // Handle temp voice generator - join generator with 5s delay before creating temp channel
      if (channel.type === 'temp_voice_generator') {
        const perms = await calculatePermissions(request.user!.id, channel.server_id, channelId);
        if (!hasPermission(perms.voice, VoicePermissions.CONNECT)) {
          return forbidden(reply, 'You don\'t have permission to create a temp channel');
        }

        // Join the generator channel itself (user will be auto-moved after 5s)
        const token = await generateLiveKitToken({
          identity: request.user!.id,
          room: `voice:${channelId}`,
          canPublish: hasPermission(perms.voice, VoicePermissions.SPEAK),
          canPublishVideo: false,
          canPublishScreen: false,
          canSubscribe: true,
        });

        await redis.joinVoiceChannel(request.user!.id, channelId);

        // Schedule temp channel creation after 5 seconds
        scheduleTempChannelCreation(request.user!.id, channelId, channel.server_id);

        // Get user info for socket event
        const user = await db.users.findById(request.user!.id);

        // Check for custom join sound
        const customJoinSound = await db.userVoiceSounds.findByUserServerType(request.user!.id, channel.server_id, 'join');

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
            is_temp_channel: false,
            custom_sound_url: customJoinSound?.sound_url || null,
          },
        });

        return {
          token,
          url: getLiveKitUrl(),
          room_name: `voice:${channelId}`,
          channel_id: channelId,
          is_temp_channel: false,
          is_temp_generator: true,
          bitrate: channel.bitrate || 64000,
          user_limit: 0,
          permissions: {
            canSpeak: hasPermission(perms.voice, VoicePermissions.SPEAK),
            canVideo: false,
            canStream: false,
            canMuteMembers: false,
            canMoveMembers: false,
            canDisconnectMembers: false,
            canDeafenMembers: false,
          },
        };
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
      const isAfkChannel = channel.is_afk_channel === true;
      const canSpeak = hasPermission(perms.voice, VoicePermissions.SPEAK);

      // Generate LiveKit token with appropriate grants
      // AFK channel: no publish/subscribe — full silence, no audio in or out
      const token = await generateLiveKitToken({
        identity: request.user!.id,
        room: `voice:${actualChannelId}`,
        canPublish: isAfkChannel ? false : isStageChannel ? canSpeak : hasPermission(perms.voice, VoicePermissions.SPEAK),
        canPublishVideo: isAfkChannel ? false : hasPermission(perms.voice, VoicePermissions.VIDEO),
        canPublishScreen: isAfkChannel ? false : hasPermission(perms.voice, VoicePermissions.STREAM),
        canSubscribe: !isAfkChannel,
      });

      // Track voice state in Redis
      await redis.joinVoiceChannel(request.user!.id, actualChannelId);

      // Get user info for socket event
      const user = await db.users.findById(request.user!.id);

      // Check for custom join sound
      const customJoinSound = await db.userVoiceSounds.findByUserServerType(request.user!.id, channel.server_id, 'join');

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
          custom_sound_url: customJoinSound?.sound_url || null,
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

      // Cancel any pending temp channel creation (user left before 5s)
      cancelPendingCreation(request.user!.id);

      // Remove from Redis voice state
      await redis.leaveVoiceChannel(request.user!.id);

      // Get user info for socket event
      const user = await db.users.findById(request.user!.id);

      // Check for custom leave sound
      const customLeaveSound = await db.userVoiceSounds.findByUserServerType(request.user!.id, channel.server_id, 'leave');

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
          custom_sound_url: customLeaveSound?.sound_url || null,
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

  /**
   * GET /voice/me - Get the current user's voice channel state
   * Returns the channel they're in (if any) and their voice state
   */
  fastify.get('/me', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const userId = request.user!.id;
      
      // Get the user's current voice channel from Redis
      const channelId = await redis.getUserVoiceChannel(userId);
      
      if (!channelId) {
        return { 
          in_voice: false,
          channel_id: null,
          channel_name: null,
          voice_state: null,
        };
      }

      // Get channel info
      const channel = await db.channels.findById(channelId);
      if (!channel) {
        // Channel doesn't exist anymore, clean up
        await redis.leaveVoiceChannel(userId);
        return {
          in_voice: false,
          channel_id: null,
          channel_name: null,
          voice_state: null,
        };
      }

      // Get voice state
      const voiceState = await redis.getVoiceState(channelId, userId);

      return {
        in_voice: true,
        channel_id: channelId,
        channel_name: channel.name,
        voice_state: voiceState ? {
          is_muted: voiceState.is_muted || false,
          is_deafened: voiceState.is_deafened || false,
          is_streaming: voiceState.is_streaming || false,
          joined_at: voiceState.joined_at,
        } : null,
      };
    },
  });

  /**
   * GET /voice/participants - Get all voice participants across all channels
   * Returns a map of channel_id -> participants for all voice channels with users
   */
  fastify.get('/participants', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      // Get all voice-type channels
      const voiceChannels = await db.sql`
        SELECT id, name, type FROM channels
        WHERE type IN ('voice', 'temp_voice', 'temp_voice_generator', 'music')
      `;

      const result: Record<string, Array<{
        user_id: string;
        username: string;
        display_name: string | null;
        avatar_url: string | null;
        is_muted: boolean;
        is_deafened: boolean;
        is_streaming?: boolean;
      }>> = {};

      // Fetch participants for each channel
      for (const channel of voiceChannels) {
        const participantIds = await redis.getVoiceChannelParticipants(channel.id);
        
        if (participantIds.length > 0) {
          const participants = await Promise.all(participantIds.map(async (userId: string) => {
            const user = await db.users.findById(userId);
            const voiceState = await redis.getVoiceState(channel.id, userId);
            
            return {
              user_id: userId,
              username: user?.username || 'Unknown',
              display_name: user?.display_name || null,
              avatar_url: user?.avatar_url || null,
              is_muted: voiceState?.is_muted || false,
              is_deafened: voiceState?.is_deafened || false,
              is_streaming: voiceState?.is_streaming || false,
            };
          }));
          
          result[channel.id] = participants;
        }
      }

      return { channels: result };
    },
  });
};
