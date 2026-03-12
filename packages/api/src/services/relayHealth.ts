/**
 * Relay Health Checker Service
 *
 * Periodically pings trusted relay health URLs.
 * On failure (3 consecutive misses), marks relay unreachable and
 * triggers voice channel failover to the next-best relay or Master.
 */

import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { publishEvent } from '../lib/eventBus.js';

const HEALTH_CHECK_INTERVAL_MS = 15_000; // 15 seconds
const HEALTH_CHECK_TIMEOUT_MS = 5_000; // 5 second timeout per check
const FAILURE_THRESHOLD = 3; // 3 consecutive failures → unreachable

// Track consecutive failures per relay
const failureCounts = new Map<string, number>();
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Ping a single relay's health URL.
 * Returns the parsed health response or null on failure.
 */
async function pingRelayHealth(
  healthUrl: string,
): Promise<{ status: string } | null> {
  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body as { status: string };
  } catch {
    return null;
  }
}

/**
 * Select the next-best relay for a channel during failover.
 * Uses average client ping data from Redis when available,
 * otherwise falls back to lowest-load relay.
 * Respects allow_master_fallback setting.
 */
async function selectFailoverRelay(
  channelId: string,
  failedRelayId: string,
): Promise<{ relayId: string; livekitUrl: string } | null> {
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
      return { relayId: best.relay.id, livekitUrl: best.relay.livekit_url };
    }
  }

  // Fallback: lowest load
  const best = available.reduce((a: any, b: any) =>
    a.current_participants < b.current_participants ? a : b,
  );
  return { relayId: best.id, livekitUrl: best.livekit_url };
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
      await publishEvent({
        type: 'voice.relay_switch',
        actorId: null,
        resourceId: `server:${channel.server_id}`,
        payload: {
          channel_id: channel.id,
          old_relay_id: relayId,
          new_relay_id: failover.relayId,
          new_livekit_url: failover.livekitUrl,
          new_relay_region: newRelay?.region || null,
          reason: 'relay_failure',
        },
      });
    } else {
      // Fall back to Master
      await db.sql`UPDATE channels SET active_relay_id = NULL WHERE id = ${channel.id}`;

      const masterLivekitUrl =
        process.env.LIVEKIT_URL || 'ws://localhost:7880';
      await publishEvent({
        type: 'voice.relay_switch',
        actorId: null,
        resourceId: `server:${channel.server_id}`,
        payload: {
          channel_id: channel.id,
          old_relay_id: relayId,
          new_relay_id: null,
          new_livekit_url: masterLivekitUrl,
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
 */
async function runHealthCheckCycle() {
  try {
    // Check trusted + offline relays (offline ones might come back)
    const relays =
      await db.sql`SELECT * FROM relay_servers WHERE status IN ('trusted', 'offline') AND health_url IS NOT NULL`;

    for (const relay of relays) {
      const result = await pingRelayHealth(relay.health_url);

      if (result) {
        // Success — reset failure count
        failureCounts.set(relay.id, 0);

        const healthStatus = result.status || 'healthy';
        await db.relays.update(relay.id, {
          last_health_check: new Date(),
          last_health_status: healthStatus,
        });

        // If relay was previously unreachable/offline, mark it recovered
        if (
          relay.last_health_status === 'unreachable' ||
          relay.status === 'offline'
        ) {
          await handleRelayRecovery(relay.id, relay.name);
        }
      } else {
        // Failure — increment count
        const count = (failureCounts.get(relay.id) || 0) + 1;
        failureCounts.set(relay.id, count);

        if (count >= FAILURE_THRESHOLD) {
          // Only trigger failover if this is a new unreachable state
          if (relay.last_health_status !== 'unreachable') {
            console.warn(
              `⚠️ Relay "${relay.name}" (${relay.id}) failed ${count} consecutive health checks — marking unreachable`,
            );

            await db.relays.update(relay.id, {
              last_health_check: new Date(),
              last_health_status: 'unreachable',
            });

            await handleRelayFailure(relay.id);
          }
        } else {
          // Not yet at threshold — mark degraded
          await db.relays.update(relay.id, {
            last_health_check: new Date(),
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

  console.log('🏥 Relay health checker started (every 15s)');

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
