# sgChat - Self-hosted Voice Community Application.

[![GitHub License](https://img.shields.io/github/license/DemonFiend/sgChat)](https://github.com/DemonFiend/sgChat/blob/main/LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/DemonFiend/sgChat)](https://github.com/DemonFiend/sgChat/issues)
[![GitHub Stars](https://img.shields.io/github/stars/DemonFiend/sgChat)](https://github.com/DemonFiend/sgChat/stargazers)

A modern, self-hosted chat platform that combines the best features of Discord, Revolt, and Guilded with real-time messaging capabilities.

## 🚀 Live Demo

Demo is currently Down till all the core features are implemented.

All Features are Experimental until the Official V1.0.0 Release. 

Features may experience visual bugs or unexpected behaviour, please report this via the issues section. 

## 🔧 Technologies Used

### Backend
- **Runtime**: Node.js 20+ with TypeScript
- **API Framework**: Fastify + Socket.IO
- **Database**: PostgreSQL 16
- **Cache**: Redis 7
- **Storage**: MinIO (S3-compatible)
- **Voice/Video**: LiveKit
- **Push Notifications**: ntfy

### Frontend
- **Desktop Client**: Tauri 2.0 + SolidJS + TypeScript + Vite
- **Mobile Client**: React Native (V2)
- **Web Client**: SolidJS + TypeScript + Vite
- **Admin Panel**: React-admin
- **Styling**: Tailwind CSS + CSS Variables
- **State Management**: SolidJS Signals + Custom Stores

## 📋 Features Implemented

### 💬 Messaging
✅ Real-time text messaging with Socket.IO  
✅ Message editing and deletion  
✅ Message reactions (emoji)  
✅ Message pinning  
✅ Message replies with cross-segment reference handling  
✅ File attachments with type/size validation  
✅ Typing indicators  
✅ Read receipts and unread message counts  
✅ Giphy integration (trending/search)  

### 📞 Voice & Video
✅ Voice channels with LiveKit integration  
✅ Video streaming (permission-based)  
✅ Screen sharing (permission-based)  
✅ DM voice calls  
✅ Temporary voice channels (auto-cleanup when empty)  
✅ Voice state tracking (mute, deafen, streaming)  
✅ AFK channel auto-move  
✅ Voice participant management (move, disconnect, mute)  
✅ User limits and bitrate configuration  

### 📺 Live Streaming / Screen Share
✅ Full-screen stream viewer overlay  
✅ Host preview (see your own stream)  
✅ Picture-in-Picture (PiP) mode via browser API  
✅ Minimize to audio-only mode (listen while browsing)  
✅ Stream audio controls (volume slider, mute)  
✅ Live viewer count display  
✅ Quality selection (720p, 1080p, Native)  
✅ Browser fullscreen support  

### 💌 Direct Messages
✅ DM channels with auto-creation on friendship  
✅ Message status tracking (sent/received/read)  
✅ DM voice calls  
✅ Friend system (requests, accept/reject)  
✅ User blocking  

### 🏠 Server Management
✅ Server creation, update, and deletion  
✅ Channel management with reordering  
✅ Category management with permission overrides  
✅ Role management with templates and bulk operations  
✅ Granular role-based permissions system  
✅ Channel permission overrides (role and user level)  
✅ Member management (kick, ban, timeout)  
✅ Invite system with expiration and max uses  
✅ Server transfer ownership  
✅ Welcome channel and announcement channels  
✅ Server popup configuration (welcome messages)  
✅ Audit logging for server actions  

### 🔐 Security & Authentication
✅ JWT access tokens + httpOnly refresh token cookies  
✅ Password hashing with Argon2  
✅ Password reset via email  
✅ Credential encryption (AES-GCM for "Remember me")  
✅ Rate limiting (per-endpoint)  
✅ Admin claim code system  
✅ Session management with token rotation  

### 🎨 User Experience
✅ User status (online, idle, dnd, offline)  
✅ Custom status with text, emoji, and expiration  
✅ Themes (Dark, Light, OLED, Nord) with system preference detection  
✅ Avatar management with history tracking  
✅ Display names and profile customization  
✅ Timezone support (public/private)  
✅ User search by username  
✅ Presence coalescing (throttled updates)  

### 🏗️ Infrastructure
✅ Message archiving to MinIO cold storage (gzip compressed)  
✅ Message segmentation for efficient history management  
✅ Retention policies (time-based and size-based)  
✅ Message export (JSON/CSV with date range filtering)  
✅ Storage statistics per channel/DM  
✅ Event bus system (pub/sub for real-time events)  
✅ SSE fallback gateway with sequence tracking  
✅ Idempotency support (Idempotency-Key header)  
✅ Redis caching (sessions, presence, voice state)  
✅ Health checks  
✅ Client-side message caching with ETag/hash-based sync  
✅ Debounced ACK requests (reduces server load)  

### 🔔 Notifications
✅ Push notifications via ntfy  
✅ Mention notifications  
✅ Friend request notifications  
✅ Reaction notifications  
✅ Priority levels  

## 🔮 Planned Features (TODO List)

### 💬 Messaging Improvements
- [ ] Message search functionality with filters
- [ ] Custom emoji support (server-specific)
- [ ] Sticker packs
- [ ] Message scheduling UI (backend supports queued_at)
- [ ] Rich text editor (markdown rendering exists)

### 🔐 Security & Privacy
- [ ] Two-factor authentication (2FA/TOTP)
- [ ] Device tracking and session management UI
- [ ] Message encryption at rest
- [ ] End-to-end encryption for voice/video calls

### 🎨 User Experience
- [ ] Comprehensive keyboard shortcuts
- [ ] Accessibility improvements (screen readers, ARIA labels)
- [ ] Language localization (i18n)
- [ ] Theme customization with live preview

### 🏗️ Infrastructure & Performance
- [ ] Load balancing and horizontal scaling
- [ ] CDN integration for media files
- [ ] Analytics dashboard for server metrics
- [ ] Advanced database optimization

### 🎤 Voice & Video Enhancements
- [ ] Audio Check
- [ ] Bringing in Video (Webcam) 
- [ ] Virtual backgrounds and effects

## ⚠️ Known Limitations

### Screen Share Audio Capture (Browser Limitation)
The `getDisplayMedia()` browser API has inherent limitations for audio capture:

| Share Type | Audio Behavior |
|------------|----------------|
| **Browser Tab** | Captures tab audio only |
| **Window** | No isolated app audio (system audio or nothing) |
| **Entire Screen** | Captures all system audio |

**Why can't I share audio from a specific app (Spotify, YouTube, etc.)?**

Browsers intentionally do not expose per-application audio routing for privacy and security reasons. The `getDisplayMedia()` API cannot isolate audio streams from individual applications.

**Workarounds:**
- Share a **browser tab** if your content is web-based (captures that tab's audio only)
- Use **system audio** and close other audio sources
- For advanced use cases, a native desktop application or browser extension with elevated permissions would be required

## 🚀 Getting Started

### Prerequisites

- Docker & Docker Compose
- Node.js 20+
- pnpm 8+

### Development

```
# Install dependencies
pnpm install

# Start development servers
pnpm dev

# Build all packages
pnpm build
```

### Production Deployment


```
# Configure environment
cp docker/.env.example docker/.env
# Edit docker/.env with your settings

# Start all services
cd docker
docker-compose up -d
```
### Project Structure


```
sgchat/
├── packages/
│   ├── shared/          # Shared types, validators, constants
│   ├── api/             # Fastify server (main API)
│   ├── client-core/     # Shared React components
│   ├── client-desktop/  # Tauri desktop app
│   ├── client-web/      # Web fallback client
│   ├── client-mobile/   # React Native (V2) - Mobile client
│   └── admin/           # React-admin dashboard for admins
├── docker/              # Docker compose and configs
├── themes/              # Bundled themes
└── docs/                # Documentation
```
### 🤝 Contributing
Contributions are welcome! Please follow these steps:

Fork the repository
Create a feature branch (git checkout -b feature/AmazingFeature)
Commit your changes (git commit -m 'Add some AmazingFeature')
Push to the branch (git push origin feature/AmazingFeature)
Open a Pull Request
### 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.

### 🙏 Acknowledgments
Built with modern web technologies
Real-time communication powered by Fastify and Socket.IO
Self-hosted push notifications through ntfy

### Proof of concept Photos: 
Login: https://imgur.com/a/KkAJ8FL
Friends/DMs: https://imgur.com/a/HQFJlbd
Server: https://imgur.com/a/SGehJfG
Server options: https://imgur.com/a/h1hMYsE
Server permissions: https://imgur.com/a/z1mE8W1
