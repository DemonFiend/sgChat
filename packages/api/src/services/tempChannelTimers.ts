/**
 * Temp Channel Timer Management
 *
 * Manages the 5-second delay between a user joining a temp_voice_generator
 * channel and the system creating their temp voice channel.
 */

import { redis } from '../lib/redis.js';
import { db } from '../lib/db.js';
import { publishEvent } from '../lib/eventBus.js';
import { createTempVoiceChannel } from './tempChannels.js';

interface PendingCreation {
  generatorChannelId: string;
  serverId: string;
  timer: NodeJS.Timeout;
}

const pendingCreations = new Map<string, PendingCreation>();

/**
 * Schedule a temp channel creation after 5 seconds.
 * If the user leaves before 5s, call cancelPendingCreation() to abort.
 */
export function scheduleTempChannelCreation(
  userId: string,
  generatorChannelId: string,
  serverId: string
): void {
  // Cancel any existing pending creation for this user
  cancelPendingCreation(userId);

  const timer = setTimeout(async () => {
    pendingCreations.delete(userId);

    try {
      // Verify user is still in the generator channel
      const currentChannel = await redis.getUserVoiceChannel(userId);
      if (currentChannel !== generatorChannelId) {
        return; // User already left or moved
      }

      // Create the temp channel
      const { channelId: tempChannelId, channelName } = await createTempVoiceChannel(
        userId,
        generatorChannelId
      );

      // Remove user from the generator channel in Redis and publish voice.leave
      // so other clients update their participant lists. The frontend's
      // handleForceMove() skips emitting voice:leave (it trusts the backend
      // to have already cleaned up), and the subsequent join() call will add
      // the user to the temp channel via redis.joinVoiceChannel().
      await redis.leaveVoiceChannel(userId);

      await publishEvent({
        type: 'voice.leave',
        actorId: userId,
        resourceId: `server:${serverId}`,
        payload: {
          channel_id: generatorChannelId,
          user_id: userId,
        },
      });

      // Send force_move event so the frontend auto-moves the user
      await publishEvent({
        type: 'voice.force_move',
        actorId: null,
        resourceId: `user:${userId}`,
        payload: {
          from_channel_id: generatorChannelId,
          to_channel_id: tempChannelId,
          to_channel_name: channelName,
        },
      });

      console.log(`🎤 Temp channel ${channelName} created after 5s delay, moving user ${userId}`);
    } catch (err) {
      console.error(`Failed to create temp channel for user ${userId}:`, err);
    }
  }, 5000);

  pendingCreations.set(userId, { generatorChannelId, serverId, timer });
}

/**
 * Cancel a pending temp channel creation (e.g., user left before 5s).
 */
export function cancelPendingCreation(userId: string): void {
  const pending = pendingCreations.get(userId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingCreations.delete(userId);
  }
}

/**
 * Check if a user has a pending temp channel creation.
 */
export function hasPendingCreation(userId: string): boolean {
  return pendingCreations.has(userId);
}
