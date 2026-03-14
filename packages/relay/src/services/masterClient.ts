import { signPayload } from '../lib/crypto.js';
import type { RelayConfig } from '../config.js';

export class MasterClient {
  private config: RelayConfig;
  private masterUrl: string;

  constructor(config: RelayConfig) {
    this.config = config;
    this.masterUrl = config.master_url.replace(/\/$/, '');
  }

  private static readonly DEFAULT_TIMEOUT_MS = 10_000;

  private async signedFetch(path: string, options: RequestInit = {}, timeoutMs?: number): Promise<Response> {
    const url = `${this.masterUrl}${path}`;
    const timestamp = Date.now().toString();
    const body = options.body ? String(options.body) : '';
    const signatureInput = `${options.method || 'GET'}:${path}:${timestamp}:${body}`;
    const signature = signPayload(signatureInput, this.config.shared_secret);

    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');
    headers.set('X-Relay-Id', this.config.relay_id);
    headers.set('X-Relay-Timestamp', timestamp);
    headers.set('X-Relay-Signature', signature);

    return fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(timeoutMs ?? MasterClient.DEFAULT_TIMEOUT_MS),
    });
  }

  async heartbeat(data: {
    current_participants: number;
    active_rooms: string[];
    health: {
      status: string;
      cpu_usage_percent: number;
      memory_usage_percent: number;
      uptime_seconds: number;
    };
  }): Promise<boolean> {
    try {
      const response = await this.signedFetch('/api/internal/relay/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ relay_id: this.config.relay_id, ...data }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(`[MasterClient] Heartbeat rejected: ${response.status} ${text}`);
      }
      return response.ok;
    } catch (err) {
      console.warn('[MasterClient] Heartbeat failed:', (err as Error).message);
      return false;
    }
  }

  async voiceAuthorize(
    userId: string,
    channelId: string,
  ): Promise<{ token: string; url: string } | null> {
    try {
      const response = await this.signedFetch('/api/internal/relay/voice-authorize', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, channel_id: channelId }),
      });
      if (!response.ok) return null;
      return response.json() as Promise<{ token: string; url: string }>;
    } catch (err) {
      console.warn('[MasterClient] Voice authorize failed:', (err as Error).message);
      return null;
    }
  }

  async fetchVoiceCache(): Promise<{
    channels: any[];
    permission_snapshots: any[];
    users: any[];
  } | null> {
    try {
      const response = await this.signedFetch('/api/internal/relay/voice-cache', {
        method: 'GET',
      });
      if (!response.ok) return null;
      return response.json() as Promise<{ channels: any[]; permission_snapshots: any[]; users: any[] }>;
    } catch (err) {
      console.warn('[MasterClient] Voice cache fetch failed:', (err as Error).message);
      return null;
    }
  }

  async forwardVoiceEvent(event: {
    type: string;
    user_id: string;
    channel_id: string;
    data?: Record<string, unknown>;
  }): Promise<boolean> {
    try {
      const response = await this.signedFetch('/api/internal/relay/voice-event', {
        method: 'POST',
        body: JSON.stringify(event),
      });
      return response.ok;
    } catch (err) {
      console.warn('[MasterClient] Voice event forward failed:', (err as Error).message);
      return false;
    }
  }
}
