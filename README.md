# sgChat - Self-hosted Discord/Revolt/Guilded Clone

[![GitHub License](https://img.shields.io/github/license/DemonFiend/sgChat)](https://github.com/DemonFiend/sgChat/blob/main/LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/DemonFiend/sgChat)](https://github.com/DemonFiend/sgChat/issues)
[![GitHub Stars](https://img.shields.io/github/stars/DemonFiend/sgChat)](https://github.com/DemonFiend/sgChat/stargazers)

A modern, self-hosted chat platform that combines the best features of Discord, Revolt, and Guilded with real-time messaging capabilities.

## 🚀 Live Demo

[![Deploy](https://img.shields.io/badge/Deploy-Click%20Here-blue)](https://sgchat.vercel.app)

## 🔧 Technologies Used

### Backend
- **Runtime**: Node.js 20+ with TypeScript
- **API Framework**: Fastify + Socket.IO
- **Database**: PostgreSQL 16
- **Cache**: Redis 7
- **Storage**: MinIO (S3-compatible)
- **Push Notifications**: ntfy

### Frontend
- **Desktop Client**: Tauri 2.0 + React + TypeScript + Vite
- **Mobile Client**: React Native (V2)
- **Web Fallback**: React + TypeScript
- **Admin Panel**: React-admin
- **Styling**: Tailwind CSS + CSS Variables
- **State Management**: Zustand

## 📋 Features Implemented

✅ Real-time Text Messaging  
✅ Direct Messages with delivery status  
✅ Light/Dark/AMOLED themes with custom CSS support  
✅ Granular role-based permissions system  
✅ Auto-detection and AFK channel management  
✅ Self-hosted push notifications via ntfy  
✅ Admin panel for server management  

## 🔮 Planned Features (TODO List)

### 💬 Messaging Improvements
- [ ] Message search functionality with filters
- [ ] Message pinning and archiving
- [ ] Rich text formatting (bold, italic, etc.)
- [ ] Custom emoji support
- [ ] Sticker packs and GIFs
- [ ] Message scheduling and reminders

### 📱 Mobile Experience
- [ ] Native mobile app improvements for iOS/Android
- [ ] Push notification optimization for mobile
- [ ] Offline message sync capabilities
- [ ] Mobile-specific UI enhancements

### 🔐 Security & Privacy
- [ ] Two-factor authentication (2FA)
- [ ] Session management and device tracking
- [ ] Message encryption at rest
- [ ] Data export and account deletion features

### 🎨 User Experience
- [ ] Customizable user status and presence indicators
- [ ] Chat theme customization with preview
- [ ] Keyboard shortcuts for desktop client
- [ ] Accessibility improvements (screen readers, etc.)
- [ ] Language localization support

### 🏗️ Infrastructure & Performance
- [ ] Load balancing and horizontal scaling
- [ ] Database optimization and indexing
- [ ] Caching strategy improvements
- [ ] CDN integration for media files
- [ ] Analytics dashboard for server metrics

### 🎤 Voice & Video Features (Planned)
- [ ] Voice chat capabilities with LiveKit
- [ ] Screen sharing functionality  
- [ ] End-to-end encryption for voice/video calls
- [ ] Call recording capabilities
- [ ] Virtual backgrounds and effects

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