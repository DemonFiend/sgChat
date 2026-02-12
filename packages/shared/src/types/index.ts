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

// ============================================================
// A4: Notification types
// ============================================================

export type NotificationType =
  | 'mention'
  | 'reaction'
  | 'role_change'
  | 'invite'
  | 'announcement'
  | 'friend_request'
  | 'friend_accept'
  | 'dm_message'
  | 'system';

export type NotificationPriority = 'low' | 'normal' | 'high';

export interface Notification {
  id: UUID;
  user_id: UUID;
  type: NotificationType;
  data: Record<string, unknown>;
  priority: NotificationPriority;
  read_at: Date | null;
  created_at: Date;
}

export interface CreateNotificationRequest {
  type: NotificationType;
  data: Record<string, unknown>;
  priority?: NotificationPriority;
}

// ============================================================
// A3: Status comment update payload
// ============================================================

export interface StatusCommentUpdatePayload {
  user_id: UUID;
  text: string | null;
  emoji: string | null;
  expires_at: string | null;
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

// ============================================================
// A0: Live SLOs & Transport Baseline — Event Envelope
// ============================================================

/**
 * All real-time event types emitted through the gateway.
 * Convention: `resource.action` (dot-separated).
 */
export type EventType =
  // Messages
  | 'message.new'
  | 'message.update'
  | 'message.delete'
  // DMs
  | 'dm.message.new'
  | 'dm.message.update'
  | 'dm.message.delete'
  // Presence
  | 'presence.update'
  // Status comments
  | 'status_comment.update'
  // Typing
  | 'typing.start'
  | 'typing.stop'
  // Voice
  | 'voice.join'
  | 'voice.leave'
  | 'voice.state_update'
  // Notifications
  | 'notification.new'
  | 'notification.read'
  // Friend requests
  | 'friend.request.new'
  | 'friend.request.accepted'
  | 'friend.request.declined'
  | 'friend.removed'
  // Server / channel admin
  | 'channel.create'
  | 'channel.update'
  | 'channel.delete'
  | 'member.join'
  | 'member.leave'
  | 'role.updated'
  | 'channel.overwrite.updated'
  // System
  | 'gateway.hello'
  | 'gateway.heartbeat'
  | 'gateway.heartbeat_ack'
  | 'gateway.resume'
  | 'gateway.ready';

/**
 * Standard event envelope for all real-time events.
 *
 * Every event delivered over WebSocket (Socket.IO) or SSE MUST be
 * wrapped in this envelope so clients can detect ordering gaps,
 * de-duplicate via `id`, and request resync when needed.
 *
 * SLO targets:
 *   P50 ≤ 200 ms, P95 ≤ 500 ms end-to-end delivery.
 */
export interface EventEnvelope<T = unknown> {
  /** Globally unique event id (UUIDv4) */
  id: string;
  /** Dot-separated event type */
  type: EventType;
  /** ISO-8601 timestamp of when the event was created on the server */
  timestamp: string;
  /** User ID of the actor who caused the event (null for system events) */
  actor_id: string | null;
  /** The resource this event targets (channel id, dm id, user id, server id) */
  resource_id: string;
  /**
   * Monotonically increasing sequence number scoped to `resource_id`.
   * Clients MUST compare `sequence` with their last-seen value;
   * if a gap is detected, request resync via `GET /api/events/resync`.
   */
  sequence: number;
  /** Event-specific payload */
  payload: T;
  /** Optional trace id for distributed tracing (OpenTelemetry compatible) */
  trace_id?: string;
}

/**
 * Client resync request: sent when the client detects a sequence gap.
 */
export interface ResyncRequest {
  /** The resource to resync (channel_id, dm_id, etc.) */
  resource_id: string;
  /** The last sequence number the client received */
  last_sequence: number;
  /** Maximum number of events to return */
  limit?: number;
}

/**
 * Server resync response: missed events since `last_sequence`.
 */
export interface ResyncResponse {
  resource_id: string;
  events: EventEnvelope[];
  /** If true, there are more events — client should paginate */
  has_more: boolean;
}

/**
 * Gateway HELLO payload — sent on initial connection.
 */
export interface GatewayHello {
  /** Recommended heartbeat interval in ms */
  heartbeat_interval: number;
  /** Session id for resume */
  session_id: string;
}

/**
 * Gateway READY payload — sent after auth + room setup.
 */
export interface GatewayReady {
  user: {
    id: string;
    username: string;
    status: UserStatus;
  };
  /** Mapping of resource_id → current sequence so client can detect gaps */
  sequences: Record<string, number>;
  /** Subscribed resource IDs (channels, servers, DMs) */
  subscriptions: string[];
}

/**
 * Gateway RESUME request — sent by client to resume a previous session
 * after a brief disconnect (e.g. network blip).
 *
 * Instead of the full HELLO → READY flow, the server replays missed events
 * from durable streams and re-joins rooms without re-fetching everything.
 */
export interface GatewayResume {
  /** The session_id from the original gateway.hello */
  session_id: string;
  /**
   * Mapping of resource_id → last sequence the client received.
   * The server will replay events with sequence > this value.
   */
  last_sequences: Record<string, number>;
}

/**
 * Gateway RESUMED response — sent after a successful resume.
 * Contains the replayed (missed) events and current sequences.
 */
export interface GatewayResumed {
  /** The session that was resumed */
  session_id: string;
  /** Events the client missed during the disconnect, ordered by resource + sequence */
  missed_events: EventEnvelope[];
  /** Updated sequence map so the client is fully caught up */
  sequences: Record<string, number>;
  /** Subscribed resource IDs (may have changed if channels were created/deleted) */
  subscriptions: string[];
}
