/**
 * Server Bootstrap - Single-Tenant Initialization
 *
 * On first startup, creates the default server with:
 * - Default categories (Server Info, General Chat, Voice Channels)
 * - Default channels (#announcements, #roles, #welcome, #general, #moderator-chat, Lounge, Music/Stage, AFK)
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

  const [serverInfoCategory] = await db.sql`
    INSERT INTO categories (server_id, name, position)
    VALUES (${server.id}, 'Server Info', 0)
    RETURNING id
  `;

  const [generalChatCategory] = await db.sql`
    INSERT INTO categories (server_id, name, position)
    VALUES (${server.id}, 'General Chat', 1)
    RETURNING id
  `;

  const [voiceCategory] = await db.sql`
    INSERT INTO categories (server_id, name, position)
    VALUES (${server.id}, 'Voice Channels', 2)
    RETURNING id
  `;

  console.log(`✅ Created categories: Server Info, General Chat, Voice Channels`);

  // ============================================================
  // CREATE DEFAULT CHANNELS
  // ============================================================

  // Get @everyone role for permission overrides
  const [everyoneRole] = await db.sql`
    SELECT id FROM roles WHERE server_id = ${server.id} AND name = '@everyone'
  `;

  const [moderatorRole] = await db.sql`
    SELECT id FROM roles WHERE server_id = ${server.id} AND name = 'Moderator'
  `;

  // --- Server Info channels ---

  // #announcements (announcement type)
  await db.sql`
    INSERT INTO channels (server_id, name, type, topic, position, category_id)
    VALUES (
      ${server.id},
      'announcements',
      'announcement',
      'Important server announcements',
      0,
      ${serverInfoCategory.id}
    )
  `;

  // #roles (text, read-only + reactions allowed)
  const [rolesChannel] = await db.sql`
    INSERT INTO channels (server_id, name, type, topic, position, category_id)
    VALUES (
      ${server.id},
      'roles',
      'text',
      'React to assign yourself roles',
      1,
      ${serverInfoCategory.id}
    )
    RETURNING id
  `;

  // Deny @everyone SEND_MESSAGES on #roles (reactions still allowed by default perms)
  await db.sql`
    INSERT INTO channel_permission_overrides (
      channel_id, role_id, text_permissions_allow, text_permissions_deny
    ) VALUES (
      ${rolesChannel.id},
      ${everyoneRole.id},
      '0',
      ${String(1n << 11n)}
    )
  `;

  console.log(`✅ Created Server Info channels: #announcements, #roles`);

  // --- General Chat channels ---

  // #welcome (text, read-only for @everyone)
  const [welcomeChannel] = await db.sql`
    INSERT INTO channels (server_id, name, type, topic, position, category_id)
    VALUES (
      ${server.id},
      'welcome',
      'text',
      'Welcome new members! Join and leave messages appear here.',
      0,
      ${generalChatCategory.id}
    )
    RETURNING id
  `;

  // Deny @everyone SEND_MESSAGES on #welcome
  await db.sql`
    INSERT INTO channel_permission_overrides (
      channel_id, role_id, text_permissions_allow, text_permissions_deny
    ) VALUES (
      ${welcomeChannel.id},
      ${everyoneRole.id},
      '0',
      ${String(1n << 11n)}
    )
  `;

  // #general (text)
  await db.sql`
    INSERT INTO channels (server_id, name, type, topic, position, category_id)
    VALUES (
      ${server.id},
      'general',
      'text',
      'General discussion',
      1,
      ${generalChatCategory.id}
    )
  `;

  // #moderator-chat (text, restricted to Moderator+)
  const [moderatorChannel] = await db.sql`
    INSERT INTO channels (server_id, name, type, topic, position, category_id)
    VALUES (
      ${server.id},
      'moderator-chat',
      'text',
      'Private channel for moderators and admins',
      2,
      ${generalChatCategory.id}
    )
    RETURNING id
  `;

  // Deny @everyone VIEW_CHANNEL on #moderator-chat
  await db.sql`
    INSERT INTO channel_permission_overrides (
      channel_id, role_id, text_permissions_allow, text_permissions_deny
    ) VALUES (
      ${moderatorChannel.id},
      ${everyoneRole.id},
      '0',
      ${String(1n << 10n)}
    )
  `;

  // Allow Moderator VIEW_CHANNEL on #moderator-chat
  if (moderatorRole) {
    await db.sql`
      INSERT INTO channel_permission_overrides (
        channel_id, role_id, text_permissions_allow, text_permissions_deny
      ) VALUES (
        ${moderatorChannel.id},
        ${moderatorRole.id},
        ${String(1n << 10n)},
        '0'
      )
    `;
  }

  console.log(`✅ Created General Chat channels: #welcome, #general, #moderator-chat`);

  // --- Voice Channels ---

  // Lounge (voice, 64kbps)
  await db.sql`
    INSERT INTO channels (server_id, name, type, position, bitrate, user_limit, category_id)
    VALUES (
      ${server.id},
      'Lounge',
      'voice',
      0,
      64000,
      0,
      ${voiceCategory.id}
    )
  `;

  // Music/Stage (music type, 128kbps)
  await db.sql`
    INSERT INTO channels (server_id, name, type, position, bitrate, user_limit, category_id)
    VALUES (
      ${server.id},
      'Music/Stage',
      'music',
      1,
      128000,
      0,
      ${voiceCategory.id}
    )
  `;

  // AFK Channel (voice, 8kbps, is_afk)
  const [afkChannel] = await db.sql`
    INSERT INTO channels (server_id, name, type, position, bitrate, user_limit, is_afk_channel, category_id)
    VALUES (
      ${server.id},
      'AFK Channel',
      'voice',
      2,
      8000,
      0,
      true,
      ${voiceCategory.id}
    )
    RETURNING id
  `;

  console.log(`✅ Created Voice Channels: Lounge, Music/Stage, AFK Channel`);

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
