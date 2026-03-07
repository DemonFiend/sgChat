import { z } from 'zod';
import { MAX_MESSAGE_LENGTH } from '../constants.js';

// User validators
export const usernameSchema = z
  .string()
  .min(2, 'Username must be at least 2 characters')
  .max(32, 'Username must be at most 32 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens');

export const emailSchema = z.string().email('Invalid email address');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

/** Password format for network transit: must be sha256-prehashed */
export const transitPasswordSchema = z
  .string()
  .regex(
    /^sha256:[a-f0-9]{64}$/,
    'Password must be pre-hashed (sha256:<hex>). Plaintext passwords are not accepted.',
  );

export const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string(),
});

// Server validators
export const serverNameSchema = z
  .string()
  .min(1, 'Server name is required')
  .max(100, 'Server name must be at most 100 characters');

export const createServerSchema = z.object({
  name: serverNameSchema,
  icon_url: z.string().url().optional(),
});

// Channel validators
export const channelNameSchema = z
  .string()
  .min(1, 'Channel name is required')
  .max(100, 'Channel name must be at most 100 characters')
  .regex(/^[a-z0-9-]+$/, 'Channel names can only contain lowercase letters, numbers, and hyphens');

export const createChannelSchema = z.object({
  name: channelNameSchema,
  type: z.enum(['text', 'voice', 'announcement', 'music']),
  topic: z.string().max(1024).optional(),
  bitrate: z.number().min(8000).max(384000).optional(),
  user_limit: z.number().min(0).max(99).optional(),
  is_afk_channel: z.boolean().optional(),
  category_id: z.string().uuid().nullable().optional(),
});

// Message validators
export const messageContentSchema = z
  .string()
  .min(1, 'Message cannot be empty')
  .max(MAX_MESSAGE_LENGTH, `Message must be at most ${MAX_MESSAGE_LENGTH} characters`);

export const sendMessageSchema = z.object({
  content: messageContentSchema,
  attachments: z.array(z.object({
    url: z.string().url(),
    filename: z.string(),
    size: z.number(),
    type: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
  })).optional(),
  reply_to_id: z.string().uuid().optional(),
  queued_at: z.string().datetime().optional(),
  is_tts: z.boolean().optional(),
  thread_id: z.string().uuid().optional(),
  sticker_ids: z.array(z.string().uuid()).max(3).optional(),
});

// Thread validators
export const createThreadSchema = z.object({
  name: z.string().min(1).max(100),
  channel_id: z.string().uuid(),
  parent_message_id: z.string().uuid().optional(),
  is_private: z.boolean().optional(),
  initial_message: z.string().min(1).max(2000).optional(),
});

export const updateThreadSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  is_archived: z.boolean().optional(),
  is_locked: z.boolean().optional(),
});

// Status validators (must match DB CHECK constraint)
export const userStatusSchema = z.enum(['online', 'idle', 'dnd', 'offline']);

export const updateStatusSchema = z.object({
  status: userStatusSchema,
});

export const updateCustomStatusSchema = z.object({
  text: z.string().max(128).nullable(),
  emoji: z.string().max(10).nullable(),
  expires_at: z.string().datetime().nullable().optional(),
});

// Invite validators
export const createInviteSchema = z.object({
  max_uses: z.number().min(0).max(1000).nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

// Role validators
export const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  // Accept both string and number for bigint compatibility
  server_permissions: z.union([z.string(), z.number()]).optional(),
  text_permissions: z.union([z.string(), z.number()]).optional(),
  voice_permissions: z.union([z.string(), z.number()]).optional(),
  // New role metadata fields
  is_hoisted: z.boolean().optional(),
  is_mentionable: z.boolean().optional(),
  description: z.string().max(256).nullable().optional(),
  icon_url: z.string().url().nullable().optional(),
  unicode_emoji: z.string().max(32).nullable().optional(),
});

// Update role validators
export const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  position: z.number().min(0).optional(),
  server_permissions: z.union([z.string(), z.number()]).optional(),
  text_permissions: z.union([z.string(), z.number()]).optional(),
  voice_permissions: z.union([z.string(), z.number()]).optional(),
  is_hoisted: z.boolean().optional(),
  is_mentionable: z.boolean().optional(),
  description: z.string().max(256).nullable().optional(),
  icon_url: z.string().url().nullable().optional(),
  unicode_emoji: z.string().max(32).nullable().optional(),
});

// Permission override validators
export const permissionOverrideSchema = z.object({
  text_allow: z.string().optional(),
  text_deny: z.string().optional(),
  voice_allow: z.string().optional(),
  voice_deny: z.string().optional(),
});

// Timeout validators
export const timeoutMemberSchema = z.object({
  duration: z.number().min(1).max(2419200), // 1 second to 28 days
  reason: z.string().max(512).optional(),
});

// Settings validators
export const updateUserSettingsSchema = z.object({
  theme_id: z.string().optional(),
  theme_variables: z.record(z.string()).optional(),
  accent_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  font_size: z.number().min(10).max(24).optional(),
  chat_density: z.enum(['compact', 'cozy', 'comfortable']).optional(),
  saturation: z.number().min(0).max(200).optional(),
  custom_css: z.string().max(50000).nullable().optional(),
  hide_online_announcements: z.boolean().optional(),
});

// A3: Status comment validator (dedicated endpoint)
export const updateStatusCommentSchema = z.object({
  text: z.string().max(128).nullable(),
  emoji: z.string().max(10).nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

// A4: Notification validators
export const notificationTypeSchema = z.enum([
  'mention', 'reaction', 'role_change', 'invite',
  'announcement', 'friend_request', 'friend_accept',
  'dm_message', 'system', 'event_start',
]);

export const notificationPrioritySchema = z.enum(['low', 'normal', 'high']);

export const markNotificationReadSchema = z.object({
  read: z.boolean().default(true),
});

export const markAllNotificationsReadSchema = z.object({
  before: z.string().datetime().optional(), // Mark all before this timestamp
});

// Server popup configuration validators
export const eventConfigSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['announcement', 'poll', 'scheduled']),
  title: z.string().min(1).max(100),
  content: z.string().min(1).max(1000),
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  enabled: z.boolean(),
});

export const updatePopupConfigSchema = z.object({
  serverName: z.string().min(1).max(100).optional(),
  serverIconUrl: z.string().url().nullable().optional(),
  bannerUrl: z.string().url().nullable().optional(),
  timeFormat: z.enum(['12h', '24h']).optional(),
  motd: z.string().max(2000).nullable().optional(),
  motdEnabled: z.boolean().optional(),
  description: z.string().max(500).nullable().optional(),
  timezone: z.string().max(50).optional(),
  welcomeChannelId: z.string().uuid().nullable().optional(),
  welcomeMessage: z.string().max(500).nullable().optional(),
  events: z.array(eventConfigSchema).optional(),
});

// Webhook validators
export const createWebhookSchema = z.object({
  channel_id: z.string().uuid(),
  name: z.string().min(1).max(80),
  avatar_url: z.string().url().nullable().optional(),
});

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateServerInput = z.infer<typeof createServerSchema>;
export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export type UpdateCustomStatusInput = z.infer<typeof updateCustomStatusSchema>;
export type UpdateStatusCommentInput = z.infer<typeof updateStatusCommentSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type PermissionOverrideInput = z.infer<typeof permissionOverrideSchema>;
export type TimeoutMemberInput = z.infer<typeof timeoutMemberSchema>;
export type UpdateUserSettingsInput = z.infer<typeof updateUserSettingsSchema>;
export type UpdatePopupConfigInput = z.infer<typeof updatePopupConfigSchema>;
export type EventConfigInput = z.infer<typeof eventConfigSchema>;
export type CreateThreadInput = z.infer<typeof createThreadSchema>;
export type UpdateThreadInput = z.infer<typeof updateThreadSchema>;

// ============================================================
// Role Reaction validators
// ============================================================

export const createRoleReactionGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  channel_id: z.string().uuid(),
  position: z.number().min(0).optional(),
  enabled: z.boolean().optional(),
  remove_roles_on_disable: z.boolean().optional(),
});

export const updateRoleReactionGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  channel_id: z.string().uuid().optional(),
  position: z.number().min(0).optional(),
  remove_roles_on_disable: z.boolean().optional(),
});

export const toggleRoleReactionGroupSchema = z.object({
  enabled: z.boolean(),
  remove_roles: z.boolean().optional(),
});

export const createRoleReactionMappingSchema = z.object({
  emoji: z.string().min(1).max(32),
  role_id: z.string().uuid(),
  label: z.string().max(100).nullable().optional(),
});

export const updateRoleReactionMappingSchema = z.object({
  emoji: z.string().min(1).max(32).optional(),
  role_id: z.string().uuid().optional(),
  label: z.string().max(100).nullable().optional(),
});

export const reorderRoleReactionMappingsSchema = z.object({
  mapping_ids: z.array(z.string().uuid()),
});

export const roleReactionSetupSchema = z.object({
  channel_id: z.string().uuid(),
});

export const formatChannelSchema = z.object({
  channel_id: z.string().uuid(),
});

export type CreateRoleReactionGroupInput = z.infer<typeof createRoleReactionGroupSchema>;
export type UpdateRoleReactionGroupInput = z.infer<typeof updateRoleReactionGroupSchema>;
export type ToggleRoleReactionGroupInput = z.infer<typeof toggleRoleReactionGroupSchema>;
export type CreateRoleReactionMappingInput = z.infer<typeof createRoleReactionMappingSchema>;
export type UpdateRoleReactionMappingInput = z.infer<typeof updateRoleReactionMappingSchema>;
export type ReorderRoleReactionMappingsInput = z.infer<typeof reorderRoleReactionMappingsSchema>;
export type RoleReactionSetupInput = z.infer<typeof roleReactionSetupSchema>;
export type FormatChannelInput = z.infer<typeof formatChannelSchema>;

// ============================================================
// Activity / Rich Presence validators
// ============================================================

export const updateActivitySchema = z.object({
  type: z.enum(['playing', 'listening', 'watching', 'streaming', 'competing', 'custom']),
  name: z.string().min(1).max(128),
  details: z.string().max(128).nullable().optional(),
  state: z.string().max(128).nullable().optional(),
  started_at: z.string().nullable().optional(),
  large_image_url: z.string().url().nullable().optional(),
  small_image_url: z.string().url().nullable().optional(),
});

export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;

// ============================================================
// Keybinds validators
// ============================================================

export const updateKeybindsSchema = z.record(z.string().max(50), z.string().max(50));

export type UpdateKeybindsInput = z.infer<typeof updateKeybindsSchema>;

// ============================================================
// Channel notification settings validators
// ============================================================

export const channelNotificationSettingsSchema = z.object({
  level: z.enum(['all', 'mentions', 'none', 'default']),
  suppress_everyone: z.boolean().optional(),
  suppress_roles: z.boolean().optional(),
});

export type ChannelNotificationSettingsInput = z.infer<typeof channelNotificationSettingsSchema>;

// ============================================================
// Releases validators
// ============================================================

export const createReleaseSchema = z.object({
  version: z.string().min(1).max(20),
  platform: z.enum(['windows', 'mac', 'linux', 'all']).optional(),
  download_url: z.string().url(),
  changelog: z.string().max(5000).nullable().optional(),
  required: z.boolean().optional(),
});

export type CreateReleaseInput = z.infer<typeof createReleaseSchema>;

// ============================================================
// Crash reports validators
// ============================================================

export const crashReportSchema = z.object({
  version: z.string().min(1).max(20),
  platform: z.string().min(1).max(20),
  error_type: z.string().max(100).optional(),
  error_message: z.string().max(1000).optional(),
  stack_trace: z.string().max(10000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CrashReportInput = z.infer<typeof crashReportSchema>;

// ============================================================
// Emoji validators
// ============================================================

export const emojiShortcodeSchema = z
  .string()
  .min(2, 'Shortcode must be at least 2 characters')
  .max(32, 'Shortcode must be at most 32 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Shortcode can only contain letters, numbers, and underscores');

export const createEmojiPackSchema = z.object({
  name: z.string().min(1, 'Pack name is required').max(50, 'Pack name must be at most 50 characters'),
  description: z.string().max(200).optional(),
});

export const updateEmojiPackSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
});

export const updateEmojiSchema = z.object({
  shortcode: emojiShortcodeSchema,
});

export const addTypedReactionSchema = z.object({
  reaction: z.discriminatedUnion('type', [
    z.object({ type: z.literal('unicode'), value: z.string().min(1).max(32) }),
    z.object({ type: z.literal('custom'), emojiId: z.string().uuid() }),
  ]),
});

export const emojiGgImportSchema = z.object({
  packUrl: z.string().url().optional(),
  packId: z.string().optional(),
}).refine(data => data.packUrl || data.packId, { message: 'Either packUrl or packId is required' });

export const zipImportSchema = z.object({
  // ZIP file is sent via file upload, no additional body params required
});

export type CreateEmojiPackInput = z.infer<typeof createEmojiPackSchema>;
export type UpdateEmojiPackInput = z.infer<typeof updateEmojiPackSchema>;
export type UpdateEmojiInput = z.infer<typeof updateEmojiSchema>;
export type AddTypedReactionInput = z.infer<typeof addTypedReactionSchema>;

// ============================================================
// Server Events validators
// ============================================================

export const createServerEventSchema = z.object({
  title: z.string().min(1, 'Title is required').max(150, 'Title must be at most 150 characters'),
  description: z.string().max(2000).nullable().optional(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime().optional(),
  announce_at_start: z.boolean().optional(),
  announcement_channel_id: z.string().uuid().nullable().optional(),
  visibility: z.enum(['public', 'private']).optional(),
  role_ids: z.array(z.string().uuid()).optional(),
});

export const updateServerEventSchema = z.object({
  title: z.string().min(1).max(150).optional(),
  description: z.string().max(2000).nullable().optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  announce_at_start: z.boolean().optional(),
  announcement_channel_id: z.string().uuid().nullable().optional(),
  visibility: z.enum(['public', 'private']).optional(),
  role_ids: z.array(z.string().uuid()).optional(),
});

export const rsvpSchema = z.object({
  status: z.enum(['interested', 'tentative', 'not_interested']),
});

export const eventListQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be in YYYY-MM format (01-12)'),
});

export type CreateServerEventInput = z.infer<typeof createServerEventSchema>;
export type UpdateServerEventInput = z.infer<typeof updateServerEventSchema>;
export type RSVPInput = z.infer<typeof rsvpSchema>;
export type EventListQueryInput = z.infer<typeof eventListQuerySchema>;
