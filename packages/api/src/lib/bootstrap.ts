/**
 * Server Bootstrap - Single-Tenant Initialization
 *
 * On first startup, creates the default server with:
 * - Default categories (Text Channels, Voice Channels)
 * - Default channels (#welcome, #general, General Voice, AFK)
 * - Default roles (@everyone, Admin, Moderator, Member)
 * - Admin claim code for first user to claim ownership
 */
import { nanoid } from 'nanoid';
import { db } from './db.js';
import {
  DEFAULT_EVERYONE_PERMISSIONS,
  RoleTemplates,
  permissionToString,
} from '@sgchat/shared';

/**
 * Bootstrap the server on first startup
 * Creates default server, channels, categories, roles, and generates admin claim code
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

  // ============================================================
  // CREATE DEFAULT ROLES
  // ============================================================

  // Create @everyone role with default permissions (position 0 - lowest)
  await db.sql`
    INSERT INTO roles (
      server_id, name, position, color,
      server_permissions, text_permissions, voice_permissions,
      is_hoisted, is_mentionable, description
    ) VALUES (
      ${server.id},
      '@everyone',
      0,
      NULL,
      ${permissionToString(DEFAULT_EVERYONE_PERMISSIONS.server)},
      ${permissionToString(DEFAULT_EVERYONE_PERMISSIONS.text)},
      ${permissionToString(DEFAULT_EVERYONE_PERMISSIONS.voice)},
      false,
      false,
      'Default role for all members'
    )
  `;

  console.log(`✅ Created @everyone role`);

  // Create Admin role (highest position - for when ownership is claimed)
  await db.sql`
    INSERT INTO roles (
      server_id, name, position, color,
      server_permissions, text_permissions, voice_permissions,
      is_hoisted, is_mentionable, description
    ) VALUES (
      ${server.id},
      ${RoleTemplates.ADMIN.name},
      100,
      ${RoleTemplates.ADMIN.color},
      ${permissionToString(RoleTemplates.ADMIN.server)},
      ${permissionToString(RoleTemplates.ADMIN.text)},
      ${permissionToString(RoleTemplates.ADMIN.voice)},
      ${RoleTemplates.ADMIN.hoist},
      ${RoleTemplates.ADMIN.mentionable},
      ${RoleTemplates.ADMIN.description}
    )
  `;

  console.log(`✅ Created Admin role`);

  // Create Moderator role
  await db.sql`
    INSERT INTO roles (
      server_id, name, position, color,
      server_permissions, text_permissions, voice_permissions,
      is_hoisted, is_mentionable, description
    ) VALUES (
      ${server.id},
      ${RoleTemplates.MODERATOR.name},
      50,
      ${RoleTemplates.MODERATOR.color},
      ${permissionToString(RoleTemplates.MODERATOR.server)},
      ${permissionToString(RoleTemplates.MODERATOR.text)},
      ${permissionToString(RoleTemplates.MODERATOR.voice)},
      ${RoleTemplates.MODERATOR.hoist},
      ${RoleTemplates.MODERATOR.mentionable},
      ${RoleTemplates.MODERATOR.description}
    )
  `;

  console.log(`✅ Created Moderator role`);

  // Create Member role
  await db.sql`
    INSERT INTO roles (
      server_id, name, position, color,
      server_permissions, text_permissions, voice_permissions,
      is_hoisted, is_mentionable, description
    ) VALUES (
      ${server.id},
      ${RoleTemplates.MEMBER.name},
      10,
      ${RoleTemplates.MEMBER.color},
      ${permissionToString(RoleTemplates.MEMBER.server)},
      ${permissionToString(RoleTemplates.MEMBER.text)},
      ${permissionToString(RoleTemplates.MEMBER.voice)},
      ${RoleTemplates.MEMBER.hoist},
      ${RoleTemplates.MEMBER.mentionable},
      ${RoleTemplates.MEMBER.description}
    )
  `;

  console.log(`✅ Created Member role`);

  // ============================================================
  // CREATE DEFAULT CATEGORIES
  // ============================================================

  const [textCategory] = await db.sql`
    INSERT INTO categories (server_id, name, position)
    VALUES (${server.id}, 'Text Channels', 0)
    RETURNING id
  `;

  const [voiceCategory] = await db.sql`
    INSERT INTO categories (server_id, name, position)
    VALUES (${server.id}, 'Voice Channels', 1)
    RETURNING id
  `;

  const [tempChannelsCategory] = await db.sql`
    INSERT INTO categories (server_id, name, position)
    VALUES (${server.id}, 'Temp Channels', 2)
    RETURNING id
  `;

  const [afkCategory] = await db.sql`
    INSERT INTO categories (server_id, name, position)
    VALUES (${server.id}, 'AFK', 3)
    RETURNING id
  `;

  console.log(`✅ Created categories: Text Channels, Voice Channels, Temp Channels, AFK`);

  // ============================================================
  // CREATE DEFAULT CHANNELS
  // ============================================================

  // Create default text channels in Text Channels category
  const [welcomeChannel] = await db.sql`
    INSERT INTO channels (server_id, name, type, topic, position, category_id)
    VALUES (
      ${server.id},
      'welcome',
      'text',
      'Welcome to the server! Introduce yourself here.',
      0,
      ${textCategory.id}
    )
    RETURNING id
  `;

  await db.sql`
    INSERT INTO channels (server_id, name, type, topic, position, category_id)
    VALUES (
      ${server.id},
      'general',
      'text',
      'General discussion channel',
      1,
      ${textCategory.id}
    )
  `;

  console.log(`✅ Created text channels: #welcome, #general`);

  // Create default voice channels in Voice Channels category
  await db.sql`
    INSERT INTO channels (server_id, name, type, position, bitrate, user_limit, category_id)
    VALUES (
      ${server.id},
      'General Voice',
      'voice',
      0,
      64000,
      0,
      ${voiceCategory.id}
    )
  `;

  console.log(`✅ Created voice channel: General Voice`);

  // Create temp voice generator channel in Temp Channels category
  await db.sql`
    INSERT INTO channels (server_id, name, type, position, bitrate, user_limit, category_id, topic)
    VALUES (
      ${server.id},
      '➕ Create Channel',
      'temp_voice_generator',
      0,
      64000,
      0,
      ${tempChannelsCategory.id},
      'Join to create your own temporary voice channel'
    )
  `;

  console.log(`✅ Created temp voice generator channel`);

  // Create AFK channel in AFK category (separate category at bottom)
  const [afkChannel] = await db.sql`
    INSERT INTO channels (server_id, name, type, position, bitrate, user_limit, is_afk_channel, category_id)
    VALUES (
      ${server.id},
      'AFK',
      'voice',
      0,
      8000,
      0,
      true,
      ${afkCategory.id}
    )
    RETURNING id
  `;

  console.log(`✅ Created AFK channel`);

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
