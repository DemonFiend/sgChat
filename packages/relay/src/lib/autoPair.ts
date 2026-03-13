/**
 * Auto-pair logic for Docker container startup.
 * If RELAY_PAIRING_TOKEN is set and no relay-config.json exists,
 * automatically pairs with Master before starting services.
 */

import type { EnvConfig } from '../config.js';
import type { RelayPairingToken, RelayPairRequest } from '@sgchat/shared';
import { generateKeyPair, deriveSharedSecret } from './crypto.js';
import { saveRelayConfig } from './configStore.js';

export async function autoPair(tokenStr: string, env: EnvConfig): Promise<boolean> {
  console.log('  Decoding pairing token...');

  let token: RelayPairingToken;
  try {
    token = JSON.parse(Buffer.from(tokenStr, 'base64').toString('utf-8'));
  } catch {
    console.error('  Failed to decode token. Is it valid base64?');
    return false;
  }

  console.log(`  Relay: "${token.name}" (${token.region})`);
  console.log(`  Master URL: ${token.master_url}`);

  // Check expiry
  if (new Date(token.expires_at) < new Date()) {
    console.error('  Pairing token has expired. Request a new one from the admin.');
    return false;
  }

  // Generate ECDH key pair
  console.log('  Generating ECDH keypair...');
  const { publicKey, privateKey } = await generateKeyPair();

  const healthUrl =
    env.HEALTH_URL ||
    (env.PUBLIC_IP
      ? `http://${env.PUBLIC_IP}:${env.PORT}/health`
      : `http://localhost:${env.PORT}/health`);

  // Send pair request to Master
  console.log('  Pairing with Master...');
  const pairPayload: RelayPairRequest = {
    pairing_token: tokenStr,
    relay_public_key: publicKey,
    livekit_url: env.LIVEKIT_URL,
    livekit_api_key: env.LIVEKIT_API_KEY,
    livekit_api_secret: env.LIVEKIT_API_SECRET,
    health_url: healthUrl,
  };

  const masterUrl = token.master_url.replace(/\/$/, '');
  let response: Response;
  try {
    response = await fetch(`${masterUrl}/api/internal/relay/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pairPayload),
    });
  } catch (err) {
    console.error(`  Failed to reach Master at ${masterUrl}:`, (err as Error).message);
    return false;
  }

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`  Pairing failed: ${response.status} ${errorBody}`);
    return false;
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
    return false;
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

  console.log(`  Relay "${token.name}" paired successfully.`);
  return true;
}
