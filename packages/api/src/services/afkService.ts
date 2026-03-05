/**
 * AFK Auto-Move Service
 *
 * Periodically checks voice channel users for inactivity.
 * If a user has been idle longer than the server's afk_timeout
 * and is not streaming, they are force-moved to the AFK channel.
 */

import { db, sql } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { publishEvent } from '../lib/eventBus.js';
import { markTempChannelEmpty } from './tempChannels.js';

/**
 * Check all voice users across all servers and move idle users to AFK.
 * Called periodically (e.g., every 30 seconds).
 */
export async function checkAndMoveAfkUsers(): Promise<void> {
  // Get all servers that have an AFK channel configured
  const servers = await sql`
    SELECT id, afk_channel_id, afk_timeout
    FROM servers
    WHERE afk_channel_id IS NOT NULL
  `;

  if (servers.length === 0) return;

  for (const server of servers) {
    try {
      await checkServerAfkUsers(server.id, server.afk_channel_id, server.afk_timeout || 300);
    } catch (err) {
      console.error(`[AFK] Error checking server ${server.id}:`, err);
    }
  }
}

async function checkServerAfkUsers(
  serverId: string,
  afkChannelId: string,
  afkTimeoutSeconds: number
): Promise<void> {
  // Get all voice channels for this server (excluding the AFK channel itself)
  const voiceChannels = await sql`
    SELECT id, type, name FROM channels
    WHERE server_id = ${serverId}
      AND type IN ('voice', 'temp_voice', 'music')
      AND id != ${afkChannelId}
  `;

  const now = Date.now();
  const timeoutMs = afkTimeoutSeconds * 1000;

  for (const channel of voiceChannels) {
    const participantIds = await redis.getVoiceChannelParticipants(channel.id);

    for (const userId of participantIds) {
      try {
        // Check if user is streaming — exempt from AFK
        const voiceState = await redis.getVoiceState(channel.id, userId);
        if (voiceState?.is_streaming) continue;

        // Check last activity
        const lastActivity = await redis.getVoiceActivity(userId);
        if (lastActivity === null) continue; // No activity recorded, skip (shouldn't happen)

        const idleMs = now - lastActivity;
        if (idleMs < timeoutMs) continue; // Still active

        // User is AFK — force-move to AFK channel
        console.log(`[AFK] Moving user ${userId} to AFK channel (idle ${Math.round(idleMs / 1000)}s)`);

        // Update Redis: move user from current channel to AFK channel
        await redis.leaveVoiceChannel(userId);
        await redis.joinVoiceChannel(userId, afkChannelId);

        // Force mute and deafen in AFK channel — no audio should play
        await redis.updateVoiceState(afkChannelId, userId, {
          is_muted: true,
          is_deafened: true,
        });

        // Publish force_move event to the user
        await publishEvent({
          type: 'voice.force_move',
          actorId: null,
          resourceId: `user:${userId}`,
          payload: {
            from_channel_id: channel.id,
            to_channel_id: afkChannelId,
            to_channel_name: 'AFK',
            reason: 'afk_timeout',
          },
        });

        // Also publish voice.leave for the old channel so others see them leave
        await publishEvent({
          type: 'voice.leave',
          actorId: userId,
          resourceId: `server:${serverId}`,
          payload: {
            channel_id: channel.id,
            user_id: userId,
          },
        });

        // Check if the source channel is a temp channel that is now empty
        if (channel.type === 'temp_voice') {
          const remaining = await redis.getVoiceChannelParticipants(channel.id);
          if (remaining.length === 0) {
            await markTempChannelEmpty(channel.id);
            console.log(`[AFK] Temp channel ${channel.name} is now empty after AFK move, starting cleanup timer`);
          }
        }

        // And voice.join for the AFK channel
        const user = await db.users.findById(userId);
        if (user) {
          await publishEvent({
            type: 'voice.join',
            actorId: userId,
            resourceId: `server:${serverId}`,
            payload: {
              channel_id: afkChannelId,
              user: {
                id: user.id,
                username: user.username,
                display_name: user.display_name || user.username,
                avatar_url: user.avatar_url,
              },
              is_temp_channel: false,
              custom_sound_url: null,
            },
          });
        }

        // Broadcast mute/deafen state so all clients update the user's UI
        await publishEvent({
          type: 'voice.state_update',
          actorId: null,
          resourceId: `server:${serverId}`,
          payload: {
            channel_id: afkChannelId,
            user_id: userId,
            is_muted: true,
            is_deafened: true,
            is_streaming: false,
          },
        });
      } catch (err) {
        console.error(`[AFK] Error processing user ${userId}:`, err);
      }
    }
  }
}
