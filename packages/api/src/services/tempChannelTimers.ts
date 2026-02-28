/**
 * Temp Channel Timer Management
 *
 * Manages the 5-second delay between a user joining a temp_voice_generator
 * channel and the system creating their temp voice channel.
 */

import { redis } from '../lib/redis.js';
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

      // NOTE: Do NOT update Redis here. The frontend will handle Redis state
      // via its leave() + join() cycle when it processes the force_move event.
      // Updating Redis here causes a race condition: the frontend's leave()
      // socket handler calls redis.leaveVoiceChannel() which looks up the
      // user's CURRENT channel (now the temp channel, not the generator),
      // removing them from the temp channel and corrupting participant tracking.

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
