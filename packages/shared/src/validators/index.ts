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
  type: z.enum(['text', 'voice']),
  topic: z.string().max(1024).optional(),
  bitrate: z.number().min(8000).max(384000).optional(),
  user_limit: z.number().min(0).max(99).optional(),
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
  queued_at: z.string().datetime().optional(),
});

// Status validators
export const userStatusSchema = z.enum(['active', 'idle', 'busy', 'dnd', 'invisible', 'offline']);

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
  server_permissions: z.string().optional(),
  text_permissions: z.string().optional(),
  voice_permissions: z.string().optional(),
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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateServerInput = z.infer<typeof createServerSchema>;
export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export type UpdateCustomStatusInput = z.infer<typeof updateCustomStatusSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateUserSettingsInput = z.infer<typeof updateUserSettingsSchema>;
