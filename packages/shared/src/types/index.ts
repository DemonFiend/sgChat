export type UUID = string;

// User status types (must match DB CHECK constraint)
export type UserStatus = 'online' | 'idle' | 'dnd' | 'offline';

// Message status types
export type MessageStatus = 'sending' | 'sent' | 'received' | 'failed';

// Channel types
export type ChannelType = 'text' | 'voice';

// System event types
export type SystemEventType = 'member_join' | 'member_leave' | 'member_online';

export interface User {
  id: UUID;
  username: string;
  email: string;
  avatar_url: string | null;
  status: UserStatus;
  custom_status: string | null;
  custom_status_emoji: string | null;
  status_expires_at: Date | null;
  push_token: string | null;
  push_enabled: boolean;
  last_seen_at: Date;
  created_at: Date;
}

export interface Server {
  id: UUID;
  name: string;
  icon_url: string | null;
  owner_id: UUID;
  welcome_channel_id: UUID | null;
  afk_channel_id: UUID | null;
  afk_timeout: number;
  announce_joins: boolean;
  announce_leaves: boolean;
  announce_online: boolean;
  created_at: Date;
}

export interface Channel {
  id: UUID;
  server_id: UUID;
  name: string;
  type: ChannelType;
  topic: string | null;
  position: number;
  bitrate: number; // Voice only
  user_limit: number; // Voice only
  is_afk_channel: boolean;
  created_at: Date;
}

export interface Message {
  id: UUID;
  channel_id: UUID | null;
  dm_channel_id: UUID | null;
  author_id: UUID | null;
  content: string;
  attachments: Attachment[];
  status: MessageStatus;
  queued_at: Date | null;
  sent_at: Date;
  received_at: Date | null;
  edited_at: Date | null;
  system_event: SystemEvent | null;
  created_at: Date;
}

export interface Attachment {
  url: string;
  filename: string;
  size: number;
  type: string;
  width?: number;
  height?: number;
}

export interface SystemEvent {
  type: SystemEventType;
  user_id: UUID;
  username: string;
  timestamp: Date;
}

export interface DMChannel {
  id: UUID;
  user1_id: UUID;
  user2_id: UUID;
  created_at: Date;
}

export interface Member {
  user_id: UUID;
  server_id: UUID;
  nickname: string | null;
  announce_online: boolean;
  joined_at: Date;
}

export interface Role {
  id: UUID;
  server_id: UUID;
  name: string;
  color: string | null;
  position: number;
  server_permissions: string; // Bigint as string
  text_permissions: string;
  voice_permissions: string;
  created_at: Date;
}

export interface ChannelPermissionOverride {
  id: UUID;
  channel_id: UUID;
  role_id: UUID | null;
  user_id: UUID | null;
  text_allow: string;
  text_deny: string;
  voice_allow: string;
  voice_deny: string;
}

export interface Invite {
  code: string;
  server_id: UUID;
  creator_id: UUID | null;
  max_uses: number | null;
  uses: number;
  expires_at: Date | null;
  created_at: Date;
}

export interface UserSettings {
  user_id: UUID;
  theme_id: string;
  theme_variables: Record<string, string>;
  accent_color: string;
  font_size: number;
  chat_density: 'compact' | 'cozy' | 'comfortable';
  saturation: number;
  custom_css: string | null;
  hide_online_announcements: boolean;
  updated_at: Date;
}

export interface DMReadState {
  user_id: UUID;
  dm_channel_id: UUID;
  last_read_message_id: UUID | null;
  last_read_at: Date;
}

// API Request/Response types
export interface LoginRequest {
  username: string;
  password: string;
  server_url?: string; // For client, not API
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface CreateServerRequest {
  name: string;
  icon_url?: string;
}

export interface CreateChannelRequest {
  name: string;
  type: ChannelType;
  topic?: string;
  bitrate?: number;
  user_limit?: number;
}

export interface SendMessageRequest {
  content: string;
  attachments?: Attachment[];
  queued_at?: string; // ISO date if queued offline
}

export interface UpdateStatusRequest {
  status: UserStatus;
}

export interface UpdateCustomStatusRequest {
  text: string | null;
  emoji: string | null;
  expires_at?: string | null; // ISO date
}

// Socket.IO event payloads
export interface SocketMessagePayload {
  channel_id?: UUID;
  dm_channel_id?: UUID;
  content: string;
  attachments?: Attachment[];
  queued_at?: string;
}

export interface SocketTypingPayload {
  channel_id?: UUID;
  dm_channel_id?: UUID;
}

export interface SocketPresencePayload {
  status: UserStatus;
}

export interface SocketVoiceStatePayload {
  channel_id: UUID;
  muted: boolean;
  deafened: boolean;
  video_enabled: boolean;
  screen_sharing: boolean;
}

// Permission calculation result
export interface PermissionSet {
  server: bigint;
  text: bigint;
  voice: bigint;
  isOwner: boolean;
}

// Screen share quality
export type ScreenShareQuality = 'standard' | 'high' | 'native';

export interface ScreenShareConfig {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}

// Theme
export interface Theme {
  id: string;
  name: string;
  variables: Record<string, string>;
}

export interface InstanceSettings {
  key: string;
  value: Record<string, unknown>;
  updated_at: Date;
}

// Voice state (stored in Redis)
export interface VoiceState {
  user_id: UUID;
  channel_id: UUID;
  server_id: UUID;
  muted: boolean;
  deafened: boolean;
  video_enabled: boolean;
  screen_sharing: boolean;
  last_active_at: Date;
  joined_at: Date;
}
