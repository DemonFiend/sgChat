import { api } from '@/api';

interface RelayInfo {
  id: string;
  name: string;
  region: string;
  health_url: string | null;
}

interface PingResult {
  relayId: string;
  latencyMs: number;
}

const PING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const PING_SAMPLES = 3; // Average over 3 pings per relay

let pingResults: Map<string, number> = new Map();
let pingTimer: ReturnType<typeof setInterval> | null = null;

/** Get stored ping results (relayId → avgLatencyMs) */
export function getRelayPings(): ReadonlyMap<string, number> {
  return pingResults;
}

/** Ping a single relay health URL and return latency in ms */
async function pingRelay(healthUrl: string): Promise<number | null> {
  try {
    const start = performance.now();
    const res = await fetch(healthUrl, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-cache',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return Math.round(performance.now() - start);
  } catch {
    return null;
  }
}

/** Measure average latency to a relay over multiple samples */
async function measureRelay(healthUrl: string): Promise<number | null> {
  const samples: number[] = [];
  for (let i = 0; i < PING_SAMPLES; i++) {
    const latency = await pingRelay(healthUrl);
    if (latency !== null) samples.push(latency);
  }
  if (samples.length === 0) return null;
  return Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
}

/** Fetch relay list, ping each, store results, report to Master */
async function runPingCycle() {
  try {
    const relays = await api.get<RelayInfo[]>('/api/relays');
    if (!Array.isArray(relays) || relays.length === 0) return;

    const results: PingResult[] = [];

    // Ping all relays in parallel
    const measurements = await Promise.all(
      relays
        .filter((r) => r.health_url)
        .map(async (relay) => {
          const latency = await measureRelay(relay.health_url!);
          return { relayId: relay.id, latency };
        }),
    );

    for (const { relayId, latency } of measurements) {
      if (latency !== null) {
        pingResults.set(relayId, latency);
        results.push({ relayId, latencyMs: latency });
      }
    }

    // Report to Master
    if (results.length > 0) {
      try {
        await api.post('/api/relays/ping-report', { pings: results });
      } catch {
        // Non-critical — Master may be temporarily unavailable
      }
    }
  } catch {
    // Relay list fetch failed — skip this cycle
  }
}

/** Start the periodic ping measurement service */
export function startRelayPingService() {
  if (pingTimer) return; // Already running

  // Run immediately, then every 5 minutes
  runPingCycle();
  pingTimer = setInterval(runPingCycle, PING_INTERVAL_MS);
}

/** Stop the ping service */
export function stopRelayPingService() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  pingResults = new Map();
}
