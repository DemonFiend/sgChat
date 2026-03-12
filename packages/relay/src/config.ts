import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '..', 'relay-config.json');

export interface RelayConfig {
  relay_id: string;
  master_url: string;
  shared_secret: string;
  trust_certificate: string;
  relay_public_key: string;
  relay_private_key: string;
}

export interface EnvConfig {
  PORT: number;
  HOST: string;
  RELAY_PAIRING_TOKEN?: string;
  LIVEKIT_URL: string;
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
  HEALTH_URL?: string;
}

export function getEnvConfig(): EnvConfig {
  return {
    PORT: parseInt(process.env.RELAY_PORT || '3100', 10),
    HOST: process.env.RELAY_HOST || '0.0.0.0',
    RELAY_PAIRING_TOKEN: process.env.RELAY_PAIRING_TOKEN,
    LIVEKIT_URL: process.env.LIVEKIT_URL || 'ws://localhost:7880',
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY || '',
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET || '',
    HEALTH_URL: process.env.RELAY_HEALTH_URL,
  };
}

export function loadRelayConfig(): RelayConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as RelayConfig;
  } catch {
    return null;
  }
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
