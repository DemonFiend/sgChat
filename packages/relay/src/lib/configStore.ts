import { writeFileSync, existsSync, readFileSync } from 'fs';
import { getConfigPath, type RelayConfig } from '../config.js';

export function saveRelayConfig(config: RelayConfig): void {
  const path = getConfigPath();
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
}

export function hasRelayConfig(): boolean {
  return existsSync(getConfigPath());
}

export function readRelayConfig(): RelayConfig | null {
  const path = getConfigPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}
