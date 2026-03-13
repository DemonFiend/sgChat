import { RoomServiceClient } from 'livekit-server-sdk';
import { MasterClient } from './masterClient.js';
import type { RelayConfig, EnvConfig } from '../config.js';
import { cpus, totalmem, freemem } from 'os';

const HEARTBEAT_INTERVAL = 15_000; // 15 seconds

export class HeartbeatService {
  private client: MasterClient;
  private roomService: RoomServiceClient | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();
  private consecutiveFailures = 0;

  constructor(config: RelayConfig, env?: EnvConfig) {
    this.client = new MasterClient(config);
    if (env?.LIVEKIT_API_KEY && env?.LIVEKIT_API_SECRET && env?.LIVEKIT_URL) {
      // RoomServiceClient needs HTTP URL, convert ws:// to http://
      const httpUrl = env.LIVEKIT_URL.replace(/^ws(s?):\/\//, 'http$1://');
      this.roomService = new RoomServiceClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    }
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

  private async getLiveKitStats(): Promise<{ participants: number; rooms: string[] }> {
    if (!this.roomService) return { participants: 0, rooms: [] };
    try {
      const rooms = await this.roomService.listRooms();
      let totalParticipants = 0;
      const roomNames: string[] = [];
      for (const room of rooms) {
        totalParticipants += room.numParticipants;
        roomNames.push(room.name);
      }
      return { participants: totalParticipants, rooms: roomNames };
    } catch {
      return { participants: 0, rooms: [] };
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

    const lkStats = await this.getLiveKitStats();

    const ok = await this.client.heartbeat({
      current_participants: lkStats.participants,
      active_rooms: lkStats.rooms,
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
