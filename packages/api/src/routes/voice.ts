import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { publishEvent } from '../lib/eventBus.js';
import { calculatePermissions } from '../services/permissions.js';
import {
  generateLiveKitToken,
  generateLiveKitTokenForRelay,
  getLiveKitUrl,
  getRelayLiveKitUrl,
} from '../services/livekit.js';
import type { LiveKitTokenOptions } from '../services/livekit.js';
import { VoicePermissions, ServerPermissions, hasPermission, RATE_LIMITS } from '@sgchat/shared';
import { notFound, forbidden, badRequest } from '../utils/errors.js';
import {
  markTempChannelEmpty,
  markTempChannelOccupied,
} from '../services/tempChannels.js';
import { scheduleTempChannelCreation, cancelPendingCreation } from '../services/tempChannelTimers.js';
import { getDefaultServer } from './server.js';

/**
 * Resolve the target relay for a voice channel based on its relay policy.
 * Returns the relay ID or null for Master's own LiveKit.
 */
async function resolveVoiceRelay(
  channel: any,
  userId?: string,
): Promise<string | null> {
  const policy = channel.voice_relay_policy || 'master';

  if (policy === 'master') return null;

  if (policy === 'specific' && channel.preferred_relay_id) {
    const relay = await db.relays.findById(channel.preferred_relay_id);
    if (relay && relay.status === 'trusted' && relay.livekit_url && relay.last_health_status !== 'unreachable') {
      return relay.id;
    }
    // Fallback to Master if preferred relay is unavailable
    return null;
  }

  if (policy === 'auto') {
    // If channel already has an active relay, use it (anchor until empty)
    if (channel.active_relay_id) {
      const relay = await db.relays.findById(channel.active_relay_id);
      if (relay && relay.status === 'trusted' && relay.livekit_url && relay.last_health_status !== 'unreachable') {
        return relay.id;
      }
      // Active relay is down, clear it and pick a new one
      await db.sql`UPDATE channels SET active_relay_id = NULL WHERE id = ${channel.id}`;
    }

    // Pick the best available relay using client ping data (if available) or lowest load
    const relays = await db.relays.findTrusted();
    const available = relays.filter(
      (r: any) => r.livekit_url && r.current_participants < r.max_participants && r.last_health_status !== 'unreachable',
    );

    if (available.length === 0) return null; // No relays available, use Master

    // Try to use client's ping data for selection
    let best = available[0];
    if (userId && available.length > 1) {
      const pingKeys = available.map((r: any) => `relay:ping:${userId}:${r.id}`);
      const pings = await redis.client.mget(...pingKeys);
      const scored = available.map((r: any, i: number) => ({
        relay: r,
        latency: pings[i] ? parseInt(pings[i]!, 10) : null,
      }));

      // Prefer relays with ping data; among those, pick lowest latency
      const withPing = scored.filter((s) => s.latency !== null);
      if (withPing.length > 0) {
        best = withPing.reduce((a, b) => (a.latency! < b.latency! ? a : b)).relay;
      } else {
        // No ping data — fall back to lowest load
        best = available.reduce((a: any, b: any) =>
          a.current_participants < b.current_participants ? a : b,
        );
      }
    } else if (available.length > 1) {
      best = available.reduce((a: any, b: any) =>
        a.current_participants < b.current_participants ? a : b,
      );
    }

    // Anchor this channel to the selected relay
    await db.sql`UPDATE channels SET active_relay_id = ${best.id} WHERE id = ${channel.id}`;

    return best.id;
  }

  return null;
}

/**
 * Generate a voice token, routing to relay or Master as appropriate.
 */
async function generateVoiceToken(
  channel: any,
  options: LiveKitTokenOptions,
  userId?: string,
): Promise<{ token: string; url: string; relayId: string | null; relayRegion: string | null }> {
  const relayId = await resolveVoiceRelay(channel, userId);

  if (relayId) {
    const token = await generateLiveKitTokenForRelay(relayId, options);
    const relayRecord = await db.relays.findById(relayId);
    const url = await getRelayLiveKitUrl(relayId);
    return {
      token,
      url,
      relayId,
      relayRegion: relayRecord?.region || null,
    };
  }

  const token = await generateLiveKitToken(options);
  return { token, url: getLiveKitUrl(), relayId: null, relayRegion: null };
}

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
      const actualChannelId = channel_id;
      const _isTempRedirect = false;

      if (!channel) {
        return notFound(reply, 'Voice channel');
      }

      // Handle temp voice generator - join generator with 5s delay before creating temp channel
      if (channel.type === 'temp_voice_generator') {
        const perms = await calculatePermissions(request.user!.id, channel.server_id, channel_id);
        if (!hasPermission(perms.voice, VoicePermissions.CONNECT)) {
          return forbidden(reply, 'You don\'t have permission to create a temp channel');
        }

        // Get user info for socket event + LiveKit name
        const user = await db.users.findById(request.user!.id);

        // Join the generator channel itself (user will be auto-moved after 5s)
        const token = await generateLiveKitToken({
          identity: request.user!.id,
          name: user.display_name || user.username || request.user!.username,
          room: `voice:${channel_id}`,
          canPublish: hasPermission(perms.voice, VoicePermissions.SPEAK),
          canPublishVideo: false,
          canPublishScreen: false,
          canSubscribe: true,
        });

        await redis.joinVoiceChannel(request.user!.id, channel_id);

        // Schedule temp channel creation after 5 seconds
        scheduleTempChannelCreation(request.user!.id, channel_id, channel.server_id);

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

      // Track voice state in Redis
      await redis.joinVoiceChannel(request.user!.id, actualChannelId);

      // Get user info for socket event + LiveKit name
      const user = await db.users.findById(request.user!.id);

      // Generate LiveKit token with appropriate grants (routed to relay if applicable)
      // AFK channel: no publish/subscribe — full silence, no audio in or out
      const voiceResult = await generateVoiceToken(channel, {
        identity: request.user!.id,
        name: user.display_name || user.username || request.user!.username,
        room: roomName,
        canPublish: isAfkChannel ? false : isStageChannel ? canSpeak : hasPermission(perms.voice, VoicePermissions.SPEAK),
        canPublishVideo: isAfkChannel ? false : hasPermission(perms.voice, VoicePermissions.VIDEO),
        canPublishScreen: isAfkChannel ? false : hasPermission(perms.voice, VoicePermissions.STREAM),
        canSubscribe: !isAfkChannel,
      }, request.user!.id);

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
        token: voiceResult.token,
        url: voiceResult.url,
        room_name: roomName,
        channel_id: actualChannelId,
        is_temp_channel: channel.is_temp_channel || false,
        relay_id: voiceResult.relayId,
        relay_region: voiceResult.relayRegion,
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
      const actualChannelId = channelId;

      if (!channel) {
        return notFound(reply, 'Channel');
      }

      // Handle temp voice generator - join generator with 5s delay before creating temp channel
      if (channel.type === 'temp_voice_generator') {
        const perms = await calculatePermissions(request.user!.id, channel.server_id, channelId);
        if (!hasPermission(perms.voice, VoicePermissions.CONNECT)) {
          return forbidden(reply, 'You don\'t have permission to create a temp channel');
        }

        // Get user info for socket event + LiveKit name
        const user = await db.users.findById(request.user!.id);

        // Join the generator channel itself (user will be auto-moved after 5s)
        const token = await generateLiveKitToken({
          identity: request.user!.id,
          name: user.display_name || user.username || request.user!.username,
          room: `voice:${channelId}`,
          canPublish: hasPermission(perms.voice, VoicePermissions.SPEAK),
          canPublishVideo: false,
          canPublishScreen: false,
          canSubscribe: true,
        });

        await redis.joinVoiceChannel(request.user!.id, channelId);

        // Schedule temp channel creation after 5 seconds
        scheduleTempChannelCreation(request.user!.id, channelId, channel.server_id);

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

      // Track voice state in Redis
      await redis.joinVoiceChannel(request.user!.id, actualChannelId);

      // Get user info for socket event + LiveKit name
      const user = await db.users.findById(request.user!.id);

      // Generate LiveKit token with relay routing
      // AFK channel: no publish/subscribe — full silence, no audio in or out
      const voiceResult = await generateVoiceToken(channel, {
        identity: request.user!.id,
        name: user.display_name || user.username || request.user!.username,
        room: `voice:${actualChannelId}`,
        canPublish: isAfkChannel ? false : isStageChannel ? canSpeak : hasPermission(perms.voice, VoicePermissions.SPEAK),
        canPublishVideo: isAfkChannel ? false : hasPermission(perms.voice, VoicePermissions.VIDEO),
        canPublishScreen: isAfkChannel ? false : hasPermission(perms.voice, VoicePermissions.STREAM),
        canSubscribe: !isAfkChannel,
      }, request.user!.id);

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

      const speak = isAfkChannel ? false : isStageChannel ? canSpeak : hasPermission(perms.voice, VoicePermissions.SPEAK);
      const video = isAfkChannel ? false : hasPermission(perms.voice, VoicePermissions.VIDEO);
      const stream = isAfkChannel ? false : hasPermission(perms.voice, VoicePermissions.STREAM);

      return {
        token: voiceResult.token,
        livekit_token: voiceResult.token,
        url: voiceResult.url,
        livekit_url: voiceResult.url,
        room_name: `voice:${actualChannelId}`,
        channel_id: actualChannelId,
        is_temp_channel: channel.is_temp_channel || false,
        relay_id: voiceResult.relayId,
        relay_region: voiceResult.relayRegion,
        bitrate: channel.bitrate || 64000,
        user_limit: channel.user_limit || 0,
        permissions: {
          canSpeak: speak,
          canVideo: video,
          canStream: stream,
          canMuteMembers: hasPermission(perms.voice, VoicePermissions.MUTE_MEMBERS),
          canMoveMembers: hasPermission(perms.voice, VoicePermissions.MOVE_MEMBERS),
          canDisconnectMembers: hasPermission(perms.voice, VoicePermissions.DISCONNECT_MEMBERS),
          canDeafenMembers: hasPermission(perms.voice, VoicePermissions.DEAFEN_MEMBERS),
          can_speak: speak,
          can_video: video,
          can_stream: stream,
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
        name: request.user!.username,
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

      // Remove user from old channel in Redis and publish voice.leave
      // so other clients update their participant lists before the move.
      await redis.leaveVoiceChannel(user_id);

      await publishEvent({
        type: 'voice.leave',
        actorId: user_id,
        resourceId: `server:${fromChannel.server_id}`,
        payload: {
          channel_id: from_channel_id,
          user_id: user_id,
        },
      });

      // Check if source channel is a temp channel that is now empty
      if (fromChannel.is_temp_channel) {
        const participants = await redis.getVoiceChannelParticipants(from_channel_id);
        if (participants.length === 0) {
          await markTempChannelEmpty(from_channel_id);
          console.log(`🕐 Temp channel is now empty after member move, starting cleanup timer`);
        }
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

      // Server-side cleanup (don't rely on client to emit voice:leave)
      await redis.leaveVoiceChannel(user_id);

      // Publish voice.leave so other clients update participant lists
      await publishEvent({
        type: 'voice.leave',
        actorId: user_id,
        resourceId: `server:${channel.server_id}`,
        payload: {
          channel_id,
          user_id,
        },
      });

      // Notify the disconnected user
      await publishEvent({
        type: 'voice.force_disconnect',
        actorId: request.user!.id,
        resourceId: `user:${user_id}`,
        payload: {
          channel_id,
          disconnected_by: request.user!.id,
        },
      });

      // Check if temp channel is now empty
      if (channel.is_temp_channel) {
        const participants = await redis.getVoiceChannelParticipants(channel_id);
        if (participants.length === 0) {
          await markTempChannelEmpty(channel_id);
          console.log(`🕐 Temp channel is now empty after force disconnect, starting cleanup timer`);
        }
      }

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

      // Check if channel is now empty
      const remainingParticipants = await redis.getVoiceChannelParticipants(channelId);
      if (remainingParticipants.length === 0) {
        // Clear active relay anchor for auto-policy channels
        if (channel.voice_relay_policy === 'auto' && channel.active_relay_id) {
          await db.sql`UPDATE channels SET active_relay_id = NULL WHERE id = ${channelId}`;
        }

        // Check if temp channel cleanup needed
        if (channel.is_temp_channel) {
          await markTempChannelEmpty(channelId);
          console.log(`Temp channel ${channel.name} is now empty, starting cleanup timer`);
        }
      }

      return { message: 'Left voice channel' };
    },
  });

  // Server mute member (moderator action)
  fastify.post('/server-mute', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: RATE_LIMITS.VOICE_JOIN.max,
        timeWindow: `${RATE_LIMITS.VOICE_JOIN.window} seconds`,
      },
    },
    handler: async (request, reply) => {
      const { user_id, channel_id, muted } = request.body as {
        user_id: string;
        channel_id: string;
        muted: boolean;
      };

      const channel = await db.channels.findById(channel_id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }
      const perms = await calculatePermissions(request.user!.id, channel.server_id);

      if (!hasPermission(perms.voice, VoicePermissions.MUTE_MEMBERS)) {
        return forbidden(reply, 'Missing MUTE_MEMBERS permission');
      }

      // Update Redis voice state
      await redis.updateVoiceState(channel_id, user_id, { is_server_muted: muted });

      // Notify target user
      await publishEvent({
        type: 'voice.server_mute',
        actorId: request.user!.id,
        resourceId: `user:${user_id}`,
        payload: {
          channel_id,
          muted,
          muted_by: request.user!.id,
        },
      });

      // Broadcast state update to server room so others see mute icon
      await publishEvent({
        type: 'voice.state_update',
        actorId: request.user!.id,
        resourceId: `server:${channel.server_id}`,
        payload: {
          channel_id,
          user_id,
          is_server_muted: muted,
        },
      });

      return { message: muted ? 'Member server muted' : 'Member server unmuted' };
    },
  });

  // Server deafen member (moderator action)
  fastify.post('/server-deafen', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: RATE_LIMITS.VOICE_JOIN.max,
        timeWindow: `${RATE_LIMITS.VOICE_JOIN.window} seconds`,
      },
    },
    handler: async (request, reply) => {
      const { user_id, channel_id, deafened } = request.body as {
        user_id: string;
        channel_id: string;
        deafened: boolean;
      };

      const channel = await db.channels.findById(channel_id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }
      const perms = await calculatePermissions(request.user!.id, channel.server_id);

      if (!hasPermission(perms.voice, VoicePermissions.DEAFEN_MEMBERS)) {
        return forbidden(reply, 'Missing DEAFEN_MEMBERS permission');
      }

      // Update Redis voice state
      await redis.updateVoiceState(channel_id, user_id, { is_server_deafened: deafened });

      // Notify target user
      await publishEvent({
        type: 'voice.server_deafen',
        actorId: request.user!.id,
        resourceId: `user:${user_id}`,
        payload: {
          channel_id,
          deafened,
          deafened_by: request.user!.id,
        },
      });

      // Broadcast state update to server room
      await publishEvent({
        type: 'voice.state_update',
        actorId: request.user!.id,
        resourceId: `server:${channel.server_id}`,
        payload: {
          channel_id,
          user_id,
          is_server_deafened: deafened,
        },
      });

      return { message: deafened ? 'Member server deafened' : 'Member server undeafened' };
    },
  });

  // Set voice status (custom text status)
  fastify.put('/status', {
    onRequest: [authenticate],
    config: {
      rateLimit: {
        max: RATE_LIMITS.VOICE_JOIN.max,
        timeWindow: `${RATE_LIMITS.VOICE_JOIN.window} seconds`,
      },
    },
    handler: async (request, reply) => {
      const { channel_id, status } = request.body as {
        channel_id: string;
        status: string;
      };

      if (!channel_id) {
        return badRequest(reply, 'channel_id is required');
      }

      if (typeof status !== 'string') {
        return badRequest(reply, 'status must be a string');
      }

      const trimmedStatus = status.trim();
      if (trimmedStatus.length > 128) {
        return badRequest(reply, 'Status must be 128 characters or less');
      }

      const channel = await db.channels.findById(channel_id);
      if (!channel) {
        return notFound(reply, 'Channel');
      }

      // Check SET_VOICE_STATUS permission
      const perms = await calculatePermissions(request.user!.id, channel.server_id, channel_id);
      if (!hasPermission(perms.voice, VoicePermissions.SET_VOICE_STATUS)) {
        return forbidden(reply, 'Missing SET_VOICE_STATUS permission');
      }

      // Verify user is in the voice channel
      const userChannel = await redis.getUserVoiceChannel(request.user!.id);
      if (userChannel !== channel_id) {
        return badRequest(reply, 'You must be in this voice channel to set a status');
      }

      // Update Redis voice state
      await redis.updateVoiceState(channel_id, request.user!.id, { voice_status: trimmedStatus });

      // Broadcast state update to server room
      await publishEvent({
        type: 'voice.state_update',
        actorId: request.user!.id,
        resourceId: `server:${channel.server_id}`,
        payload: {
          channel_id,
          user_id: request.user!.id,
          voice_status: trimmedStatus,
        },
      });

      return { message: 'Voice status updated' };
    },
  });

  // Get temp channel settings (admin)
  fastify.get('/temp-settings', {
    onRequest: [authenticate],
    handler: async (_request, _reply) => {
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

      const server = await getDefaultServer();
      if (server) {
        const perms = await calculatePermissions(request.user!.id, server.id);
        const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                        server.owner_id === request.user!.id;
        if (!isAdmin) {
          return forbidden(reply, 'Administrator permission required');
        }
      }

      const { updateTempChannelSettings } = await import('../services/tempChannels.js');
      const settings = await updateTempChannelSettings(updates);
      return settings;
    },
  });

  // Manually cleanup empty temp channels (admin)
  fastify.post('/cleanup-temp-channels', {
    onRequest: [authenticate],
    handler: async (request, reply) => {
      const server = await getDefaultServer();
      if (server) {
        const perms = await calculatePermissions(request.user!.id, server.id);
        const isAdmin = hasPermission(perms.server, ServerPermissions.ADMINISTRATOR) ||
                        server.owner_id === request.user!.id;
        if (!isAdmin) {
          return forbidden(reply, 'Administrator permission required');
        }
      }

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
    handler: async (request, _reply) => {
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
          voice_status: voiceState.voice_status || undefined,
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
    handler: async (_request, _reply) => {
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
        voice_status?: string;
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
              voice_status: voiceState?.voice_status || undefined,
            };
          }));
          
          result[channel.id] = participants;
        }
      }

      return { channels: result };
    },
  });
};
