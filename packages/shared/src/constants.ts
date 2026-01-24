/**
 * Application-wide constants
 */

// Message limits
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_OFFLINE_QUEUE_SIZE = 100;

// File upload limits
export const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB default
export const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB
export const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'application/pdf',
  'text/plain',
];

// Voice/Video
export const VOICE_BITRATES = {
  MIN: 8000,
  LOW: 32000,
  NORMAL: 64000,
  HIGH: 96000,
  VERY_HIGH: 128000,
  MUSIC: 256000,
  MAX: 384000,
} as const;

export const SCREEN_SHARE_QUALITIES = {
  STANDARD: { width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
  HIGH: { width: 1920, height: 1080, fps: 60, bitrate: 6_000_000 },
  NATIVE: { width: 0, height: 0, fps: 30, bitrate: 8_000_000 },
} as const;

// AFK
export const AFK_TIMEOUT_OPTIONS = [
  300, // 5 minutes
  600, // 10 minutes
  900, // 15 minutes
  1200, // 20 minutes
  1800, // 30 minutes
  3600, // 1 hour
  7200, // 2 hours
  14400, // 4 hours
] as const;

export const AFK_WARNING_SECONDS = 30;
export const AUTO_IDLE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

// Rate limiting
export const RATE_LIMITS = {
  MESSAGE_SEND: { max: 5, window: 5 }, // 5 messages per 5 seconds
  API_READ: { max: 100, window: 60 }, // 100 requests per minute
  API_WRITE: { max: 20, window: 60 }, // 20 requests per minute
  LOGIN: { max: 5, window: 900 }, // 5 attempts per 15 minutes
  REGISTER: { max: 3, window: 3600 }, // 3 per hour
  FILE_UPLOAD: { max: 10, window: 60 }, // 10 per minute
  VOICE_JOIN: { max: 10, window: 60 }, // 10 voice joins per minute
} as const;

// Notification batching
export const NOTIFICATION_BATCH_THRESHOLD = 3;
export const NOTIFICATION_BATCH_WINDOW = 30_000; // 30 seconds

// Theme defaults
export const DEFAULT_THEME = 'dark';
export const DEFAULT_ACCENT_COLOR = '#5865f2';
export const DEFAULT_FONT_SIZE = 14;
export const DEFAULT_CHAT_DENSITY = 'cozy';
