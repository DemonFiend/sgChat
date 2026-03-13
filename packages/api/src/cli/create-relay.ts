#!/usr/bin/env node
/**
 * CLI: Create a relay server and output a setup token.
 *
 * Usage (inside the API container):
 *   node dist/cli/create-relay.js --name "US-East" --region "us-east"
 *
 * Or via docker exec:
 *   docker exec sgchat-api-1 node dist/cli/create-relay.js --name "US-East" --region "us-east"
 */

import postgres from 'postgres';
import {
  generateECDHKeyPair,
  generatePairingToken,
  encryptWithKey,
} from '../lib/relayCrypto.js';

// ── Parse CLI args ──────────────────────────────────────────

function parseArgs(): { name: string; region: string } {
  const args = process.argv.slice(2);
  let name = '';
  let region = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) {
      name = args[++i];
    } else if (args[i] === '--region' && args[i + 1]) {
      region = args[++i];
    }
  }

  if (!name || !region) {
    console.error('Usage: create-relay --name "Relay Name" --region "us-east"');
    console.error('');
    console.error('Options:');
    console.error('  --name    Display name for the relay (e.g. "US-East")');
    console.error('  --region  Region identifier (e.g. "us-east", "eu-west")');
    process.exit(1);
  }

  return { name, region };
}

// ── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { name, region } = parseArgs();

  // Derive master encryption key from JWT_SECRET (same as services/livekit.ts)
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error('Error: JWT_SECRET environment variable is not set.');
    process.exit(1);
  }

  const encryptionKey = Buffer.from(jwtSecret).toString('hex').slice(0, 64).padEnd(64, '0');

  // Connect to database
  const databaseUrl =
    process.env.DATABASE_URL || 'postgresql://sgchat:password@localhost:5432/sgchat';
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    // Verify connection
    await sql`SELECT 1`;

    // Generate ECDH key pair for pairing
    const { publicKey: masterPublicKey, privateKeyJwk: masterPrivateKey } =
      await generateECDHKeyPair();

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    const masterUrl =
      process.env.PUBLIC_URL || process.env.API_URL || 'http://localhost:3000';

    // Create relay record
    const [created] = await sql`
      INSERT INTO relay_servers (
        name, region, status, pairing_token_hash, pairing_expires_at,
        master_public_key, max_participants, allow_master_fallback
      )
      VALUES (
        ${name}, ${region}, 'pending', 'pending',
        ${expiresAt}, ${masterPublicKey}, 100, true
      )
      RETURNING *
    `;

    // Generate pairing token
    const { token: pairingToken, hash } = generatePairingToken({
      relay_id: created.id,
      name,
      region,
      master_url: masterUrl,
      master_public_key: masterPublicKey,
      expires_at: expiresAt.toISOString(),
    });

    // Encrypt master private key for storage
    const encryptedPrivateKey = await encryptWithKey(masterPrivateKey, encryptionKey);

    // Update record with token hash and encrypted key
    await sql`
      UPDATE relay_servers SET
        pairing_token_hash = ${hash},
        shared_secret_encrypted = ${encryptedPrivateKey},
        updated_at = NOW()
      WHERE id = ${created.id}
    `;

    // Output
    console.log('');
    console.log(`Relay "${name}" created (region: ${region})`);
    console.log(`Token expires: ${expiresAt.toISOString()}`);
    console.log('');
    console.log('Paste this into the relay .env file:');
    console.log('');
    console.log(`RELAY_SETUP_TOKEN=${pairingToken}`);
    console.log('');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
