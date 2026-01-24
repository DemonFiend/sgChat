/**
 * Server Bootstrap - Single-Tenant Initialization
 * 
 * On first startup, creates the default server with:
 * - 4 default channels (#welcome, #general, Voice Channel 1, Away Channel)
 * - @everyone role with basic permissions
 * - Admin claim code for first user to claim ownership
 */
import { nanoid } from 'nanoid';
import { db } from './db.js';
import { TextPermissions, VoicePermissions } from '@sgchat/shared';

// Default permissions for @everyone role
const DEFAULT_EVERYONE_TEXT = 
  TextPermissions.VIEW_CHANNEL |
  TextPermissions.SEND_MESSAGES |
  TextPermissions.EMBED_LINKS |
  TextPermissions.ATTACH_FILES |
  TextPermissions.ADD_REACTIONS |
  TextPermissions.READ_MESSAGE_HISTORY;

const DEFAULT_EVERYONE_VOICE =
  VoicePermissions.CONNECT |
  VoicePermissions.SPEAK |
  VoicePermissions.VIDEO |
  VoicePermissions.USE_VOICE_ACTIVITY;

/**
 * Bootstrap the server on first startup
 * Creates default server, channels, and generates admin claim code
 */
export async function bootstrapServer(): Promise<void> {
  // Check if a server already exists
  const [existingServer] = await db.sql`
    SELECT id, admin_claimed, admin_claim_code FROM servers LIMIT 1
  `;

  if (existingServer) {
    // Server exists - check if unclaimed and show code
    if (!existingServer.admin_claimed && existingServer.admin_claim_code) {
      logClaimCode(existingServer.admin_claim_code);
    } else if (existingServer.admin_claimed) {
      console.log('✅ Server already claimed and configured');
    }
    return;
  }

  console.log('🚀 First startup detected - bootstrapping server...');

  // Generate admin claim code
  const claimCode = nanoid(32);

  // Create the server (unclaimed - no owner yet)
  const [server] = await db.sql`
    INSERT INTO servers (
      name, 
      description,
      owner_id,
      admin_claim_code,
      admin_claimed,
      motd,
      motd_enabled,
      timezone
    ) VALUES (
      ${process.env.SERVER_NAME || 'sgChat Server'},
      'Welcome to sgChat! A self-hosted chat platform.',
      NULL,
      ${claimCode},
      false,
      'Welcome to sgChat! Use the admin claim code to become the server owner.',
      true,
      'UTC'
    )
    RETURNING id
  `;

  console.log(`✅ Created server with ID: ${server.id}`);

  // Create @everyone role with basic permissions
  const [everyoneRole] = await db.sql`
    INSERT INTO roles (
      server_id,
      name,
      color,
      position,
      server_permissions,
      text_permissions,
      voice_permissions
    ) VALUES (
      ${server.id},
      '@everyone',
      NULL,
      0,
      '0',
      ${DEFAULT_EVERYONE_TEXT.toString()},
      ${DEFAULT_EVERYONE_VOICE.toString()}
    )
    RETURNING id
  `;

  console.log(`✅ Created @everyone role`);

  // Create default text channels
  const [welcomeChannel] = await db.sql`
    INSERT INTO channels (server_id, name, type, topic, position)
    VALUES (
      ${server.id},
      'welcome',
      'text',
      'Welcome to the server! Introduce yourself here.',
      0
    )
    RETURNING id
  `;

  const [generalChannel] = await db.sql`
    INSERT INTO channels (server_id, name, type, topic, position)
    VALUES (
      ${server.id},
      'general',
      'text',
      'General discussion channel',
      1
    )
    RETURNING id
  `;

  console.log(`✅ Created text channels: #welcome, #general`);

  // Create default voice channels
  const [voiceChannel1] = await db.sql`
    INSERT INTO channels (server_id, name, type, position, bitrate, user_limit)
    VALUES (
      ${server.id},
      'Voice Channel 1',
      'voice',
      0,
      64000,
      0
    )
    RETURNING id
  `;

  const [afkChannel] = await db.sql`
    INSERT INTO channels (server_id, name, type, position, bitrate, user_limit, is_afk_channel)
    VALUES (
      ${server.id},
      'Away Channel',
      'voice',
      999,
      8000,
      0,
      true
    )
    RETURNING id
  `;

  console.log(`✅ Created voice channels: Voice Channel 1, Away Channel (AFK)`);

  // Update server with default and AFK channel references
  await db.sql`
    UPDATE servers
    SET 
      welcome_channel_id = ${welcomeChannel.id},
      afk_channel_id = ${afkChannel.id}
    WHERE id = ${server.id}
  `;

  console.log(`✅ Server bootstrap complete!`);
  console.log('');

  // Log the claim code prominently
  logClaimCode(claimCode);
}

/**
 * Log the admin claim code to console with prominent formatting
 */
function logClaimCode(code: string): void {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                     ADMIN CLAIM CODE                             ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('║                                                                  ║');
  console.log(`║  ${code}  ║`);
  console.log('║                                                                  ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('║  To claim ownership:                                             ║');
  console.log('║  1. Register an account                                          ║');
  console.log('║  2. POST /auth/claim-admin with { "code": "<code>" }             ║');
  console.log('║  3. You will become the server owner with full permissions       ║');
  console.log('║                                                                  ║');
  console.log('║  This code is valid until claimed. If lost, redeploy with       ║');
  console.log('║  a fresh database to generate a new code.                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
}
