import { redis } from '../lib/redis.js';
import { db } from '../lib/db.js';
import { publishEvent } from '../lib/eventBus.js';
import { markTempChannelEmpty } from './tempChannels.js';
import { createNotification } from '../routes/notifications.js';

interface LeaveResult {
  leftServerVoice: string | null;
  leftDMCall: string | null;
}

/**
 * Handle missed call system messages when a user leaves a DM call
 * where the other party never joined.
 */
export async function handleDMCallMissed(
  userId: string,
  dmChannelId: string,
  otherUserId: string,
): Promise<void> {
  const callStartData = await redis.client.get(`dm_call_start:${dmChannelId}`);
  const otherUserInCall = await redis.client.get(`dm_voice:${dmChannelId}:${otherUserId}`);

  if (callStartData && !otherUserInCall) {
    // Caller was alone the entire time — the other user never joined
    const [callerId, startTimestamp] = callStartData.split(':');
    const callDurationMs = Date.now() - parseInt(startTimestamp);
    const callDurationSec = callDurationMs / 1000;

    // Only create missed call messages if the call lasted ≥30 seconds and leaving user is the caller
    if (callDurationSec >= 30 && callerId === userId) {
      const user = await db.users.findById(userId);
      const isAutoKick = callDurationSec >= 295; // ~5 minutes (with small tolerance)
      const content = isAutoKick
        ? 'Call went unanswered for 5 minutes before ending.'
        : 'Missed voice call.';
      const eventType = isAutoKick ? 'dm_call_unanswered' : 'dm_call_missed';

      // Insert system message into DM chat
      const systemMessage = await db.messages.create({
        dm_channel_id: dmChannelId,
        author_id: null,
        content,
        system_event: {
          type: eventType,
          user_id: userId,
          username: user.username,
          timestamp: new Date().toISOString(),
        },
      });

      // Publish so the chat updates in real-time
      await publishEvent({
        type: 'dm.call.missed',
        actorId: null,
        resourceId: `dm:${dmChannelId}`,
        payload: {
          id: systemMessage.id,
          content: systemMessage.content,
          sender_id: null,
          created_at: systemMessage.created_at,
          system_event: systemMessage.system_event,
          dm_channel_id: dmChannelId,
        },
      });

      // Create missed_call notification for the callee
      await createNotification({
        userId: otherUserId,
        type: 'missed_call',
        data: {
          caller_id: user.id,
          caller_name: user.display_name || user.username,
          caller_avatar: user.avatar_url,
          dm_channel_id: dmChannelId,
        },
        priority: 'high',
      });
    }

    // Clean up call start tracking
    await redis.client.del(`dm_call_start:${dmChannelId}`);
  }
}

/**
 * Leave any active voice session (server voice channel or DM call).
 * Handles cleanup, event publishing, missed call logic, and temp channel management.
 * Call this before joining a new voice session to enforce one-call-at-a-time.
 */
export async function leaveAnyVoiceSession(userId: string): Promise<LeaveResult> {
  const result: LeaveResult = {
    leftServerVoice: null,
    leftDMCall: null,
  };

  // 1. Check and leave server voice channel
  const serverChannelId = await redis.getUserVoiceChannel(userId);
  if (serverChannelId) {
    const channel = await db.channels.findById(serverChannelId);
    await redis.leaveVoiceChannel(userId);

    if (channel) {
      // Look up custom leave sound
      const leaveSound = await db.userVoiceSounds.findByUserServerType(
        userId, channel.server_id, 'leave',
      );

      await publishEvent({
        type: 'voice.leave',
        actorId: userId,
        resourceId: `server:${channel.server_id}`,
        payload: {
          channel_id: serverChannelId,
          user_id: userId,
          custom_sound_url: leaveSound?.sound_url || null,
        },
      });

      // Mark temp channel as empty if no participants remain
      if (channel.is_temp_channel) {
        const participants = await redis.getVoiceChannelParticipants(serverChannelId);
        if (participants.length === 0) {
          await markTempChannelEmpty(serverChannelId);
        }
      }
    }

    result.leftServerVoice = serverChannelId;
  }

  // 2. Check and leave DM call
  const dmChannelId = await redis.getUserDMVoiceCall(userId);
  if (dmChannelId) {
    const dm = await db.dmChannels.findById(dmChannelId);
    if (dm) {
      const otherUserId = dm.user1_id === userId ? dm.user2_id : dm.user1_id;

      // Handle missed call logic before removing state
      await handleDMCallMissed(userId, dmChannelId, otherUserId);

      // Remove from Redis
      await redis.leaveDMVoiceCall(userId);

      // Get user info for notification
      const user = await db.users.findById(userId);

      // Notify the other user
      await publishEvent({
        type: 'voice.leave',
        actorId: userId,
        resourceId: `dm:${dmChannelId}`,
        payload: {
          dm_channel_id: dmChannelId,
          is_dm_call: true,
          user: {
            id: user.id,
            username: user.username,
            display_name: user.display_name || user.username,
            avatar_url: user.avatar_url,
          },
        },
      });
    } else {
      // DM channel not found in DB, just clean up Redis
      await redis.leaveDMVoiceCall(userId);
    }

    result.leftDMCall = dmChannelId;
  }

  return result;
}
