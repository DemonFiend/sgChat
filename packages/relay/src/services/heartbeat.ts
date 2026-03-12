import { MasterClient } from './masterClient.js';
import type { RelayConfig } from '../config.js';
import { cpus, totalmem, freemem } from 'os';

const HEARTBEAT_INTERVAL = 15_000; // 15 seconds

export class HeartbeatService {
  private client: MasterClient;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();
  private consecutiveFailures = 0;

  constructor(config: RelayConfig) {
    this.client = new MasterClient(config);
  }

  start(): void {
    if (this.intervalId) return;
    console.log('  Heartbeat service started (every 15s)');

    // Send first heartbeat immediately
    this.sendHeartbeat();

    this.intervalId = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    const cpuLoad =
      cpus().reduce((acc, cpu) => {
        const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
        return acc + ((total - cpu.times.idle) / total) * 100;
      }, 0) / cpus().length;

    const totalMem = totalmem();
    const memUsage = ((totalMem - freemem()) / totalMem) * 100;

    const ok = await this.client.heartbeat({
      current_participants: 0, // TODO: get from LiveKit when wired up
      active_rooms: [],
      health: {
        status: 'healthy',
        cpu_usage_percent: Math.round(cpuLoad),
        memory_usage_percent: Math.round(memUsage),
        uptime_seconds: Math.round((Date.now() - this.startTime) / 1000),
      },
    });

    if (ok) {
      if (this.consecutiveFailures > 0) {
        console.log('  Heartbeat restored after', this.consecutiveFailures, 'failures');
      }
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures++;
      if (this.consecutiveFailures % 4 === 1) {
        console.warn(`  Heartbeat failed (${this.consecutiveFailures} consecutive)`);
      }
    }
  }
}
