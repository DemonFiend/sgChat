/**
 * Temp Voice Channels Service
 * 
 * Manages temporary voice channels that are auto-created when users
 * join a "temp_voice_generator" channel and auto-deleted when empty.
 */

import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { publishEvent } from '../lib/eventBus.js';

export interface TempChannelSettings {
  empty_timeout_seconds: number;
  max_temp_channels_per_user: number;
  inherit_generator_permissions: boolean;
  default_user_limit: number;
  default_bitrate: number;
}

const DEFAULT_TEMP_SETTINGS: TempChannelSettings = {
  empty_timeout_seconds: 300, // 5 minutes
  max_temp_channels_per_user: 2,
  inherit_generator_permissions: true,
  default_user_limit: 0,
  default_bitrate: 64000,
};

/**
 * Get temp channel settings from instance_settings
 */
export async function getTempChannelSettings(): Promise<TempChannelSettings> {
  const setting = await db.instanceSettings.get('temp_channel_settings');
  if (!setting) {
    return DEFAULT_TEMP_SETTINGS;
  }
  return { ...DEFAULT_TEMP_SETTINGS, ...setting.value };
}

/**
 * Update temp channel settings
 */
export async function updateTempChannelSettings(
  updates: Partial<TempChannelSettings>
): Promise<TempChannelSettings> {
  const current = await getTempChannelSettings();
  const updated = { ...current, ...updates };
  await db.instanceSettings.set('temp_channel_settings', updated);
  return updated;
}

/**
 * Create a temp voice channel for a user
 * Called when user joins a temp_voice_generator channel
 */
export async function createTempVoiceChannel(
  userId: string,
  generatorChannelId: string
): Promise<{ channelId: string; channelName: string }> {
  // Get the generator channel info
  const [generator] = await db.sql`
    SELECT id, server_id, category_id, bitrate, user_limit
    FROM channels
    WHERE id = ${generatorChannelId} AND type = 'temp_voice_generator'
  `;

  if (!generator) {
    throw new Error('Generator channel not found');
  }

  // Get user info for channel name
  const [user] = await db.sql`
    SELECT username, display_name FROM users WHERE id = ${userId}
  `;

  if (!user) {
    throw new Error('User not found');
  }

  const settings = await getTempChannelSettings();

  // Get all existing temp channels for this user in this server (ordered by creation)
  const existingChannels = await db.sql`
    SELECT id, name FROM channels
    WHERE is_temp_channel = true
      AND temp_channel_owner_id = ${userId}
      AND server_id = ${generator.server_id}
    ORDER BY temp_channel_created_at ASC
  `;

  if (existingChannels.length > 0) {
    // Check occupancy of each channel via Redis
    const channelsWithOccupancy = await Promise.all(
      existingChannels.map(async (ch) => ({
        id: ch.id as string,
        name: ch.name as string,
        participantCount: (await redis.getVoiceChannelParticipants(ch.id)).length,
      }))
    );

    // Find first empty channel — reuse it instead of creating new
    const emptyChannel = channelsWithOccupancy.find(ch => ch.participantCount === 0);
    if (emptyChannel) {
      return { channelId: emptyChannel.id, channelName: emptyChannel.name };
    }

    // All existing channels are occupied — check if at limit
    const maxChannels = settings.max_temp_channels_per_user || 2;
    if (existingChannels.length >= maxChannels) {
      // At limit — return the first (oldest) channel
      return { channelId: existingChannels[0].id, channelName: existingChannels[0].name };
    }

    // Under limit and all occupied — fall through to create a new channel
  }

  // Create the temp channel with user's name (append number for 2nd+ channels)
  const channelNumber = existingChannels.length + 1;
  const baseName = `${user.display_name || user.username}'s Channel`;
  const channelName = channelNumber > 1 ? `${baseName} ${channelNumber}` : baseName;

  const [tempChannel] = await db.sql`
    INSERT INTO channels (
      server_id, name, type, position, bitrate, user_limit,
      category_id, is_temp_channel, temp_channel_owner_id, temp_channel_created_at
    )
    VALUES (
      ${generator.server_id},
      ${channelName},
      'temp_voice',
      ${Date.now()},
      ${settings.default_bitrate || generator.bitrate},
      ${settings.default_user_limit || generator.user_limit},
      ${generator.category_id},
      true,
      ${userId},
      NOW()
    )
    RETURNING id, name
  `;

  // Copy permission overrides from generator if enabled
  if (settings.inherit_generator_permissions) {
    await db.sql`
      INSERT INTO channel_permission_overrides (channel_id, role_id, user_id, text_allow, text_deny, voice_allow, voice_deny)
      SELECT ${tempChannel.id}, role_id, user_id, text_allow, text_deny, voice_allow, voice_deny
      FROM channel_permission_overrides
      WHERE channel_id = ${generatorChannelId}
    `;
  }

  // Publish channel create event (wrap in { channel: ... } to match frontend expectations)
  await publishEvent({
    type: 'channel.create',
    actorId: userId,
    resourceId: `server:${generator.server_id}`,
    payload: {
      channel: {
        id: tempChannel.id,
        name: tempChannel.name,
        type: 'temp_voice',
        server_id: generator.server_id,
        category_id: generator.category_id,
        position: Date.now(),
        is_temp_channel: true,
        temp_channel_owner_id: userId,
      },
    },
  });

  console.log(`🎤 Created temp voice channel: ${tempChannel.name} for user ${userId}`);

  return { channelId: tempChannel.id, channelName: tempChannel.name };
}

/**
 * Mark a temp channel as empty (starts the deletion timer)
 */
export async function markTempChannelEmpty(channelId: string): Promise<void> {
  await db.sql`
    UPDATE channels
    SET temp_channel_last_empty_at = NOW()
    WHERE id = ${channelId} AND is_temp_channel = true
  `;
}

/**
 * Mark a temp channel as occupied (clears the deletion timer)
 */
export async function markTempChannelOccupied(channelId: string): Promise<void> {
  await db.sql`
    UPDATE channels
    SET temp_channel_last_empty_at = NULL
    WHERE id = ${channelId} AND is_temp_channel = true
  `;
}

/**
 * Delete a temp voice channel
 */
export async function deleteTempVoiceChannel(channelId: string): Promise<void> {
  const [channel] = await db.sql`
    SELECT id, name, server_id FROM channels
    WHERE id = ${channelId} AND is_temp_channel = true
  `;

  if (!channel) {
    return;
  }

  // Delete the channel
  await db.sql`DELETE FROM channels WHERE id = ${channelId}`;

  // Publish channel delete event (use channel_id to match frontend expectations)
  await publishEvent({
    type: 'channel.delete',
    actorId: null,
    resourceId: `server:${channel.server_id}`,
    payload: {
      channel_id: channelId,
    },
  });

  console.log(`🗑️ Deleted temp voice channel: ${channel.name}`);
}

/**
 * Clean up empty temp channels that have exceeded the timeout
 * Should be called periodically (e.g., every minute)
 */
export async function cleanupEmptyTempChannels(): Promise<{
  deleted: number;
  channels: string[];
}> {
  const settings = await getTempChannelSettings();
  const timeoutSeconds = settings.empty_timeout_seconds;

  // Find temp channels that have been empty for longer than the timeout
  const expiredChannels = await db.sql`
    SELECT id, name, server_id
    FROM channels
    WHERE is_temp_channel = true
      AND temp_channel_last_empty_at IS NOT NULL
      AND temp_channel_last_empty_at < NOW() - (INTERVAL '1 second' * ${timeoutSeconds})
  `;

  const deleted: string[] = [];

  for (const channel of expiredChannels) {
    try {
      await deleteTempVoiceChannel(channel.id);
      deleted.push(channel.name);
    } catch (err) {
      console.error(`Failed to delete temp channel ${channel.id}:`, err);
    }
  }

  if (deleted.length > 0) {
    console.log(`🧹 Cleaned up ${deleted.length} empty temp channels`);
  }

  return { deleted: deleted.length, channels: deleted };
}

/**
 * Get all temp channels for a user
 */
export async function getUserTempChannels(
  userId: string,
  serverId?: string
): Promise<{ id: string; name: string; server_id: string }[]> {
  if (serverId) {
    return db.sql`
      SELECT id, name, server_id
      FROM channels
      WHERE is_temp_channel = true
        AND temp_channel_owner_id = ${userId}
        AND server_id = ${serverId}
    `;
  }
  
  return db.sql`
    SELECT id, name, server_id
    FROM channels
    WHERE is_temp_channel = true
      AND temp_channel_owner_id = ${userId}
  `;
}

/**
 * Check if a channel is a temp voice generator
 */
export async function isTempVoiceGenerator(channelId: string): Promise<boolean> {
  const [channel] = await db.sql`
    SELECT type FROM channels WHERE id = ${channelId}
  `;
  return channel?.type === 'temp_voice_generator';
}

/**
 * Get voice participant count for a channel
 */
export async function getVoiceParticipantCount(channelId: string): Promise<number> {
  const [result] = await db.sql`
    SELECT COUNT(*)::int as count
    FROM voice_states
    WHERE channel_id = ${channelId}
  `;
  return result?.count || 0;
}
