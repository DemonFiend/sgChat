/**
 * Relay Health Checker Service
 *
 * Monitors relay health by checking heartbeat recency.
 * Relays push their health status via POST /api/internal/relay/heartbeat
 * every 15 seconds. This service checks if heartbeats have gone stale.
 * On failure (3 consecutive stale checks), marks relay unreachable and
 * triggers voice channel failover to the next-best relay or Master.
 */

import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { publishEvent } from '../lib/eventBus.js';
import { getRelayLiveKitUrl, getLiveKitUrl } from './livekit.js';

const HEALTH_CHECK_INTERVAL_MS = 15_000; // 15 seconds
const HEARTBEAT_STALE_MS = 45_000; // 45 seconds without heartbeat → considered missed
const FAILURE_THRESHOLD = 3; // 3 consecutive stale checks → unreachable

// Track consecutive failures per relay
const failureCounts = new Map<string, number>();
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Select the next-best relay for a channel during failover.
 * Uses average client ping data from Redis when available,
 * otherwise falls back to lowest-load relay.
 * Respects allow_master_fallback setting.
 */
async function selectFailoverRelay(
  channelId: string,
  failedRelayId: string,
): Promise<{ relayId: string } | null> {
  const relays = await db.relays.findTrusted();
  const available = relays.filter(
    (r: any) =>
      r.id !== failedRelayId &&
      r.livekit_url &&
      r.last_health_status !== 'unreachable' &&
      r.current_participants < r.max_participants,
  );

  if (available.length === 0) return null; // Fall back to Master

  // Get all users currently in the channel to check their ping data
  const participants = await redis.getVoiceChannelParticipants(channelId);

  if (participants.length > 0 && available.length > 1) {
    // Compute average latency per relay across all participants
    const relayScores: { relay: any; avgLatency: number | null }[] = [];

    for (const relay of available) {
      const pingKeys = participants.map(
        (uid: string) => `relay:ping:${uid}:${relay.id}`,
      );
      const pings = await redis.client.mget(...pingKeys);
      const validPings = pings
        .filter((p): p is string => p !== null)
        .map((p) => parseInt(p, 10));

      relayScores.push({
        relay,
        avgLatency:
          validPings.length > 0
            ? validPings.reduce((a, b) => a + b, 0) / validPings.length
            : null,
      });
    }

    const withPing = relayScores.filter((s) => s.avgLatency !== null);
    if (withPing.length > 0) {
      const best = withPing.reduce((a, b) =>
        a.avgLatency! < b.avgLatency! ? a : b,
      );
      return { relayId: best.relay.id };
    }
  }

  // Fallback: lowest load
  const best = available.reduce((a: any, b: any) =>
    a.current_participants < b.current_participants ? a : b,
  );
  return { relayId: best.id };
}

/**
 * Handle a relay going unreachable: failover all affected channels.
 */
async function handleRelayFailure(relayId: string) {
  // Find all channels anchored to this relay
  const channels =
    await db.sql`SELECT * FROM channels WHERE active_relay_id = ${relayId}`;

  if (channels.length === 0) return;

  console.log(
    `⚠️ Relay ${relayId} unreachable — failing over ${channels.length} channel(s)`,
  );

  for (const channel of channels) {
    const failover = await selectFailoverRelay(channel.id, relayId);

    if (failover) {
      // Switch to another relay
      await db.sql`UPDATE channels SET active_relay_id = ${failover.relayId} WHERE id = ${channel.id}`;

      const newRelay = await db.relays.findById(failover.relayId);
      const newLivekitUrl = await getRelayLiveKitUrl(failover.relayId);
      await publishEvent({
        type: 'voice.relay_switch',
        actorId: null,
        resourceId: `server:${channel.server_id}`,
        payload: {
          channel_id: channel.id,
          old_relay_id: relayId,
          new_relay_id: failover.relayId,
          new_livekit_url: newLivekitUrl,
          new_relay_region: newRelay?.region || null,
          reason: 'relay_failure',
        },
      });
    } else {
      // Fall back to Master
      await db.sql`UPDATE channels SET active_relay_id = NULL WHERE id = ${channel.id}`;

      await publishEvent({
        type: 'voice.relay_switch',
        actorId: null,
        resourceId: `server:${channel.server_id}`,
        payload: {
          channel_id: channel.id,
          old_relay_id: relayId,
          new_relay_id: null,
          new_livekit_url: getLiveKitUrl(),
          new_relay_region: null,
          reason: 'relay_failure',
        },
      });
    }
  }
}

/**
 * Handle a relay recovering from unreachable state.
 */
async function handleRelayRecovery(relayId: string, relayName: string) {
  console.log(`✅ Relay "${relayName}" (${relayId}) recovered — marking healthy`);
  await db.relays.update(relayId, {
    status: 'trusted',
    last_health_status: 'healthy',
    last_health_check: new Date(),
  });
}

/**
 * Run one health check cycle across all trusted/suspended relays.
 * Instead of HTTP pinging, checks if the relay's last heartbeat is recent.
 * Relays push heartbeats every 15s via POST /api/internal/relay/heartbeat.
 */
async function runHealthCheckCycle() {
  try {
    const relays =
      await db.sql`SELECT * FROM relay_servers WHERE status IN ('trusted', 'offline')`;

    const now = Date.now();

    for (const relay of relays) {
      const lastCheck = relay.last_health_check
        ? new Date(relay.last_health_check).getTime()
        : 0;
      const staleDuration = now - lastCheck;
      const isHeartbeatFresh = staleDuration < HEARTBEAT_STALE_MS;

      if (isHeartbeatFresh) {
        // Heartbeat is recent — relay is alive
        failureCounts.set(relay.id, 0);

        // If relay was previously unreachable/offline, mark it recovered
        if (
          relay.last_health_status === 'unreachable' ||
          relay.status === 'offline'
        ) {
          await handleRelayRecovery(relay.id, relay.name);
        }
      } else {
        // Heartbeat is stale — increment failure count
        const count = (failureCounts.get(relay.id) || 0) + 1;
        failureCounts.set(relay.id, count);

        if (count >= FAILURE_THRESHOLD) {
          // Only trigger failover if this is a new unreachable state
          if (relay.last_health_status !== 'unreachable') {
            console.warn(
              `⚠️ Relay "${relay.name}" (${relay.id}) heartbeat stale for ${Math.round(staleDuration / 1000)}s (${count} checks) — marking unreachable`,
            );

            await db.relays.update(relay.id, {
              last_health_status: 'unreachable',
            });

            await handleRelayFailure(relay.id);
          }
        } else if (relay.last_health_status !== 'unreachable') {
          // Not yet at threshold — mark degraded
          await db.relays.update(relay.id, {
            last_health_status: 'degraded',
          });
        }
      }
    }
  } catch (err) {
    console.error('Relay health check cycle error:', err);
  }
}

/**
 * Handle graceful drain: admin sets relay to draining status.
 * No new voice joins are allowed. When current_participants reaches 0,
 * transition to offline.
 */
export async function checkDrainingRelays() {
  const draining =
    await db.sql`SELECT * FROM relay_servers WHERE status = 'draining'`;

  for (const relay of draining) {
    if (relay.current_participants === 0) {
      console.log(
        `📴 Relay "${relay.name}" (${relay.id}) drained — transitioning to offline`,
      );
      await db.relays.update(relay.id, { status: 'offline' });
    }
  }
}

/**
 * Start the periodic relay health check service.
 */
export function startRelayHealthService() {
  if (healthCheckTimer) return; // Already running

  console.log('🏥 Relay health checker started (heartbeat-based, every 15s)');

  // Run immediately, then on interval
  runHealthCheckCycle();
  healthCheckTimer = setInterval(async () => {
    await runHealthCheckCycle();
    await checkDrainingRelays();
  }, HEALTH_CHECK_INTERVAL_MS);
}

/**
 * Stop the relay health check service.
 */
export function stopRelayHealthService() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
  failureCounts.clear();
}
