# sgChat - Self-hosted Voice Community Platform

[![GitHub License](https://img.shields.io/github/license/DemonFiend/sgChat)](https://github.com/DemonFiend/sgChat/blob/main/LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/DemonFiend/sgChat)](https://github.com/DemonFiend/sgChat/issues)
[![GitHub Stars](https://img.shields.io/github/stars/DemonFiend/sgChat)](https://github.com/DemonFiend/sgChat/stargazers)

A modern, self-hosted chat platform combining the best features of Discord, Revolt, and Guilded — real-time messaging, voice/video, and full server management from a single Docker container.

All features are experimental until the official V1.0.0 release. Please report bugs via the [issues section](https://github.com/DemonFiend/sgChat/issues).

## Tech Stack

### Backend
- **Runtime**: Node.js 20+ with TypeScript (strict mode, ESM)
- **API Framework**: Fastify 4 + Socket.IO 4
- **Database**: PostgreSQL 16 (raw SQL via postgres.js, no ORM)
- **Cache**: Redis 7 (sessions, presence, voice state)
- **Storage**: MinIO (S3-compatible file storage)
- **Voice/Video**: LiveKit SFU
- **Push Notifications**: ntfy (self-hosted)

### Frontend
- **Web Client**: React 19 + TypeScript + Vite 6
- **Desktop Client**: Electron integration (Midnight theme exclusive)
- **Styling**: Tailwind CSS 4
- **State Management**: Zustand

## Features

### Messaging
- Real-time text messaging with Socket.IO
- Message editing, deletion, and replies (cross-segment reference handling)
- Message reactions (emoji)
- Message pinning with pinned messages panel
- Message search with full-text search (PostgreSQL FTS), filters, and highlighted results
- File attachments with type/size validation
- Typing indicators and read receipts
- Unread message counts
- Giphy integration (trending/search)
- Mention autocomplete (@users, #channels)

### Voice & Video
- Voice channels with LiveKit integration
- Video streaming and screen sharing (permission-based)
- DM voice calls
- Temporary voice channels (auto-cleanup when empty)
- Voice state tracking (mute, deafen, streaming)
- AFK channel with auto-move
- Voice participant management (move, disconnect, mute)
- User limits and bitrate configuration
- Soundboard (per-server audio clips)
- Custom join/leave voice sounds (per-user, per-server)
- Regional relay servers for distributed voice (see [Relay Servers](#relay-servers))

### Live Streaming / Screen Share
- Full-screen stream viewer overlay
- Host preview (see your own stream)
- Picture-in-Picture (PiP) mode
- Minimize to audio-only mode
- Stream audio controls (volume slider, mute)
- Live viewer count display
- Quality selection (720p, 1080p, Native)

### Direct Messages
- DM channels with auto-creation on friendship
- Message status tracking (sent/received/read)
- DM voice calls
- Friend system (send/accept/reject requests)
- User blocking
- DM toast notifications

### Server Management
- Server creation, update, and deletion
- Channel management with drag-and-drop reordering
- Category management with permission overrides
- Role management with templates and bulk operations
- Granular bitflag-based permissions (server, text, voice)
- Channel permission overrides (role and user level)
- Member management (kick, ban, timeout with configurable duration)
- Invite system with expiration and max uses
- Server ownership transfer
- Welcome channel and announcement channels
- Server popup configuration (welcome messages)
- Role reactions (self-service role assignment via emoji)
- Custom emoji packs (per-server, PNG/GIF/WebP/APNG, up to 500 per server)
- Sticker support (per-server, up to 50 per server)
- Audit logging with filtering by action type, user, and date range

### Events & Calendar
- Server events with start/end times and descriptions
- Month-based event browsing
- RSVP system (interested, tentative, not interested)
- Role-based event visibility (restrict events to specific roles)
- Event announcements to designated channels
- Event history tracking (including cancelled events)
- Permission-gated: `CREATE_EVENTS`, `MANAGE_EVENTS`, `RSVP_EVENTS`

### Storage Dashboard
- Server-wide storage statistics with per-category breakdowns
- Per-channel and per-DM storage tracking
- Configurable storage limits per category (messages, attachments, emojis, stickers, profiles)
- Storage threshold alerts (warning and action thresholds)
- Manual purge by category with dry-run preview
- Automated retention policies (time-based and size-based)
- Cleanup scheduling and audit logs
- Requires `ADMINISTRATOR` permission

### Relay Servers
- Distributed voice infrastructure for regional routing
- Relay pairing via secure ECDH key exchange + one-time pairing tokens
- Heartbeat-based health monitoring (15s intervals, auto-failover on 3 missed beats)
- Channel relay policies: `master` (use host), `auto` (best relay by latency/load), `specific` (pinned relay)
- Client ping reporting for latency-aware relay selection
- WebSocket proxy through master's SSL (no mixed-content issues)
- Admin lifecycle: create, suspend, drain (graceful shutdown), delete
- Per-relay participant limits and load tracking
- Relay CLI package (`packages/relay/`) for standalone deployment

### Security & Authentication
- JWT access tokens + httpOnly refresh token cookies
- Password hashing with Argon2
- Password reset via email
- Full payload encryption (ECDH + AES-256-GCM)
- Credential encryption (AES-GCM for "Remember me")
- Rate limiting (per-endpoint)
- Admin claim code system
- Session management with token rotation

### User Experience
- User status (online, idle, dnd, offline)
- Custom status with text, emoji, and expiration
- Rich presence / activity tracking
- Themes (Dark, Light, OLED, Nord, Midnight) with system preference detection
- Avatar management with history tracking
- Display names, bios, and profile banners
- Timezone support (public/private)
- User search by username
- Command palette (Ctrl+K)
- Message search (Ctrl+F)
- Presence coalescing (throttled updates)

### Infrastructure
- Auto-migrations on API startup (version-tracked)
- Message archiving to MinIO cold storage (gzip compressed)
- Message segmentation for efficient history management
- Message export (JSON/CSV with date range filtering)
- Event bus system (pub/sub for real-time events)
- Gateway protocol with heartbeat and resume support (sequence-based gap detection)
- SSE fallback gateway
- Idempotency support (Idempotency-Key header)
- Redis caching (sessions, presence, voice state)
- Health checks and version endpoints
- Client-side message caching with ETag/hash-based sync
- Desktop crash reporting

### Notifications
- Push notifications via ntfy
- Mention notifications
- Friend request notifications
- Reaction notifications
- Priority levels

## Planned Features

- Two-factor authentication (2FA/TOTP)
- End-to-end encryption for voice/video calls
- Language localization (i18n)
- Mobile client (React Native)
- Windows/Linux desktop client

## Known Limitations

### Screen Share Audio Capture (Browser Limitation)
The `getDisplayMedia()` browser API has inherent limitations for audio capture:

| Share Type | Audio Behavior |
|------------|----------------|
| **Browser Tab** | Captures tab audio only |
| **Window** | No isolated app audio (system audio or nothing) |
| **Entire Screen** | Captures all system audio |

Browsers intentionally do not expose per-application audio routing for privacy/security. For advanced use cases, the Electron desktop app provides better audio capture.

### Relay Server Networking
When deploying relay servers on the same LAN as the master, the relay must report a reachable IP address — not `localhost`. The master's API container proxies LiveKit WebSocket signaling through its own SSL, so the relay's `livekit_url` must be reachable from inside the Docker container.

- Set `PUBLIC_IP` or `LIVEKIT_PUBLIC_URL` to the relay machine's LAN IP when starting the relay
- Example: `LIVEKIT_PUBLIC_URL=ws://192.168.1.50:7880`
- If using Docker bridge networking (default), `localhost` resolves to the container itself, not the host

## Getting Started

### Prerequisites

- Docker & Docker Compose
- Node.js 20+
- pnpm 8+

### Development

```bash
# Install dependencies
pnpm install

# Start API dev server (port 3000)
pnpm dev

# Start web client dev server (port 5174)
pnpm dev:web

# Start both API and web dev servers
pnpm dev:all

# Build all packages (shared -> web -> api)
pnpm build

# Type check all packages
pnpm typecheck

# Lint all packages
pnpm lint
```

### Production Deployment

```bash
# Configure environment
cp docker/.env.example docker/.env
# Edit docker/.env with your settings

# Start all services
cd docker
docker-compose up -d
```

### Project Structure

```
sgChat-Server/
├── packages/
│   ├── shared/          # Types, Zod validators, permissions, constants
│   ├── api/             # Fastify backend + Socket.IO real-time
│   │   └── src/
│   │       ├── routes/      # REST API endpoints
│   │       ├── socket/      # Socket.IO event handlers
│   │       ├── services/    # Business logic (permissions, livekit, etc.)
│   │       ├── lib/         # DB, Redis, storage, event bus
│   │       ├── middleware/  # JWT auth middleware
│   │       ├── migrations/  # Auto-applied SQL migrations
│   │       └── plugins/     # Rate limiting, error handler
│   ├── web/             # React 19 frontend (served by API container)
│   │   └── src/
│   │       ├── layouts/     # MainLayout (app shell)
│   │       ├── components/  # UI components (layout/, ui/, voice/)
│   │       ├── stores/      # Zustand state management
│   │       ├── api/         # API client wrapper
│   │       └── lib/         # Socket service, voice service, utilities
│   └── relay/           # Standalone relay server CLI
│       └── src/
│           ├── lib/         # Auto-pairing, crypto, WebSocket proxy
│           └── services/    # Heartbeat, voice auth, event relay
├── docker/
│   ├── docker-compose.yml   # Full stack definition
│   ├── Dockerfile.api       # Builds shared -> web -> api
│   ├── Dockerfile.postgres  # PostgreSQL with pg_cron
│   ├── init.sql             # Database schema (source of truth)
│   └── livekit.yaml         # LiveKit configuration
├── docs/
│   └── CLIENT-API-REFERENCE.md  # API contract for client developers
└── CLAUDE.md                # AI agent instructions
```

### Docker Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| api | sosiagaming/sgchat-api | 3040 | API + web client |
| postgres | sosiagaming/sgchat-postgres | 3041 | Database |
| redis | redis:7-alpine | 3042 | Cache, sessions |
| minio | minio/minio | 3043 | File storage |
| livekit | livekit/livekit-server | host | Voice/video SFU |
| ntfy | binwiederhier/ntfy | 3048 | Push notifications |

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
