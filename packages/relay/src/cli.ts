#!/usr/bin/env node
import 'dotenv/config';
import { getEnvConfig } from './config.js';
import { generateKeyPair, deriveSharedSecret } from './lib/crypto.js';
import { saveRelayConfig } from './lib/configStore.js';
import type { RelayPairingToken, RelayPairRequest } from '@sgchat/shared';

async function pair(tokenStr: string): Promise<void> {
  console.log('  Decoding pairing token...');

  let token: RelayPairingToken;
  try {
    token = JSON.parse(Buffer.from(tokenStr, 'base64').toString('utf-8'));
  } catch {
    console.error('  Failed to decode token. Is it valid base64?');
    process.exit(1);
  }

  console.log(`  Relay: "${token.name}" (${token.region})`);
  console.log(`  Master URL: ${token.master_url}`);

  // Check expiry
  if (new Date(token.expires_at) < new Date()) {
    console.error('  Pairing token has expired. Request a new one from the admin.');
    process.exit(1);
  }

  // Generate ECDH key pair
  console.log('  Generating ECDH keypair...');
  const { publicKey, privateKey } = await generateKeyPair();

  const env = getEnvConfig();
  const healthUrl = env.HEALTH_URL || `http://localhost:${env.PORT}/health`;

  // Send pair request to Master
  console.log('  Pairing with Master...');
  const pairPayload: RelayPairRequest = {
    pairing_token: tokenStr,
    relay_public_key: publicKey,
    livekit_url: env.LIVEKIT_PUBLIC_URL,
    livekit_api_key: env.LIVEKIT_API_KEY,
    livekit_api_secret: env.LIVEKIT_API_SECRET,
    health_url: healthUrl,
  };

  const masterUrl = token.master_url.replace(/\/$/, '');
  const response = await fetch(`${masterUrl}/api/internal/relay/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pairPayload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`  Pairing failed: ${response.status} ${errorBody}`);
    process.exit(1);
  }

  const result = (await response.json()) as {
    relay_id: string;
    trust_certificate: string;
    shared_secret_confirmation: string;
  };

  // Derive shared secret
  const sharedSecret = await deriveSharedSecret(privateKey, token.master_public_key);

  // Verify shared secret matches confirmation
  if (result.shared_secret_confirmation !== sharedSecret.slice(0, 8)) {
    console.error('  Shared secret mismatch — pairing may have been tampered with.');
    process.exit(1);
  }

  // Save config
  saveRelayConfig({
    relay_id: result.relay_id,
    master_url: token.master_url,
    shared_secret: sharedSecret,
    trust_certificate: result.trust_certificate,
    relay_public_key: publicKey,
    relay_private_key: privateKey,
  });

  console.log('  Config saved to relay-config.json');
  console.log(`  Relay "${token.name}" is now TRUSTED and ready.`);
  console.log('  Run `sgchat-relay start` or `pnpm dev` to start the relay.');
}

// Parse CLI args
const args = process.argv.slice(2);
const command = args[0];

if (command === 'pair') {
  const tokenArg = args[1] || process.env.RELAY_PAIRING_TOKEN;
  if (!tokenArg) {
    console.error('Usage: sgchat-relay pair <pairing-token>');
    console.error('  Or set RELAY_PAIRING_TOKEN env var');
    process.exit(1);
  }
  pair(tokenArg);
} else if (command === 'start' || !command) {
  // Just import and run main
  import('./index.js');
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Usage: sgchat-relay [pair <token> | start]');
  process.exit(1);
}
