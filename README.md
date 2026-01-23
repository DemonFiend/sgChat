# VoxCord

A self-hosted Discord/Revolt/Guilded clone with voice, video, and text chat capabilities.

## Features

- 🎤 **Voice & Video Chat** - LiveKit-powered real-time communication
- 📹 **Screen Sharing** - Multiple quality tiers (720p30/1080p60/Native)
- 💬 **Text Chat** - Real-time messaging with offline support
- 📱 **Direct Messages** - Private conversations with delivery status
- 🎨 **Theming** - Light/Dark/AMOLED themes with custom CSS support
- 🔐 **Permissions** - Granular role-based access control
- 🌙 **AFK System** - Auto-detection and channel management
- 🔔 **Push Notifications** - Self-hosted via ntfy
- 👑 **Admin Panel** - Server management dashboard

## Tech Stack

### Backend
- **Runtime**: Node.js 20+ with TypeScript
- **API**: Fastify + Socket.IO
- **Database**: PostgreSQL 16
- **Cache**: Redis 7
- **Storage**: MinIO (S3-compatible)
- **Voice/Video**: LiveKit
- **Push**: ntfy

### Frontend
- **Desktop**: Tauri 2.0 + React + TypeScript + Vite
- **Mobile (V2)**: React Native
- **Styling**: Tailwind CSS + CSS Variables
- **State**: Zustand

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 20+
- pnpm 8+

### Development

```bash
# Install dependencies
pnpm install

# Start development servers
pnpm dev

# Build all packages
pnpm build
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

## Project Structure

```
voxcord/
├── packages/
│   ├── shared/          # Shared types, validators, constants
│   ├── api/             # Fastify server
│   ├── client-core/     # Shared React components
│   ├── client-desktop/  # Tauri desktop app
│   ├── client-web/      # Web fallback client
│   ├── client-mobile/   # React Native (V2)
│   └── admin/           # React-admin dashboard
├── docker/              # Docker compose and configs
├── themes/              # Bundled themes
└── docs/                # Documentation
```

## License

MIT
