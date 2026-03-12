/**
 * Voice Event Buffer
 *
 * During Master outage, buffers voice events (join/leave/mute/etc.)
 * in memory. When Master becomes reachable again, replays buffered
 * events in batch.
 */

import { MasterClient } from './masterClient.js';

interface BufferedVoiceEvent {
  type: string;
  user_id: string;
  channel_id: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

const MAX_BUFFER_SIZE = 1000;
const REPLAY_BATCH_SIZE = 50;
const REPLAY_CHECK_INTERVAL_MS = 10_000; // Check every 10s

export class EventBufferService {
  private masterClient: MasterClient;
  private buffer: BufferedVoiceEvent[] = [];
  private replayTimer: ReturnType<typeof setInterval> | null = null;
  private isReplaying: boolean = false;

  constructor(masterClient: MasterClient) {
    this.masterClient = masterClient;
  }

  /**
   * Start the periodic replay check.
   */
  start() {
    if (this.replayTimer) return;
    this.replayTimer = setInterval(() => this.tryReplay(), REPLAY_CHECK_INTERVAL_MS);
  }

  /**
   * Stop the replay check and clear the buffer.
   */
  stop() {
    if (this.replayTimer) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
    this.buffer = [];
  }

  /**
   * Buffer a voice event for later replay.
   */
  addEvent(event: {
    type: string;
    user_id: string;
    channel_id: string;
    data?: Record<string, unknown>;
  }) {
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      // Drop oldest events when buffer is full
      this.buffer.shift();
    }
    this.buffer.push({ ...event, timestamp: Date.now() });
  }

  /**
   * Get the current buffer size.
   */
  get size(): number {
    return this.buffer.length;
  }

  /**
   * Try to replay buffered events to Master.
   * Called periodically and can be called manually.
   */
  async tryReplay(): Promise<boolean> {
    if (this.buffer.length === 0 || this.isReplaying) return true;

    this.isReplaying = true;
    try {
      while (this.buffer.length > 0) {
        const batch = this.buffer.splice(0, REPLAY_BATCH_SIZE);

        // Try to forward each event in the batch
        let allSucceeded = true;
        for (const event of batch) {
          const ok = await this.masterClient.forwardVoiceEvent({
            type: event.type,
            user_id: event.user_id,
            channel_id: event.channel_id,
            data: { ...event.data, buffered_at: event.timestamp },
          });

          if (!ok) {
            // Master still unreachable — put events back and stop
            this.buffer.unshift(...batch);
            allSucceeded = false;
            break;
          }
        }

        if (!allSucceeded) return false;
      }

      if (this.buffer.length === 0) {
        console.log('✅ All buffered voice events replayed to Master');
      }
      return true;
    } catch {
      return false;
    } finally {
      this.isReplaying = false;
    }
  }
}
