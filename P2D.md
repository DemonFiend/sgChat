# Publishing2Dev: sgChat Server — Deployment & Project Guide

> **This file is in .gitignore and must NEVER be pushed to GitHub.**
> It contains deployment-specific paths, procedures, and project context for AI agents.

---

## All You Need to Know

### What is sgChat?

sgChat is a **self-hosted Discord/Revolt/Guilded-style chat platform** built as a monorepo.
It provides real-time text messaging, voice/video chat, direct messages, friend system,
role-based permissions, and theming — all served from a single Docker container.

It uses a **single-tenant architecture**: one server per instance with an admin claim system.

### Tech Stack

| Layer       | Technology                                                    |
|-------------|---------------------------------------------------------------|
| Backend     | Node.js 20, TypeScript, Fastify 4, Socket.IO 4               |
| Frontend    | SolidJS 1.9, @solidjs/router, Tailwind CSS 4, Vite 6         |
| Database    | PostgreSQL 16 (UUID primary keys)                             |
| Cache       | Redis 7 (sessions, presence, voice state)                     |
| Storage     | MinIO (S3-compatible, avatars/attachments)                    |
| Voice/Video | LiveKit (SFU server + livekit-client SDK)                     |
| Push        | ntfy (self-hosted push notifications)                         |
| Auth        | JWT access tokens (15min) + refresh tokens (7d, Redis-backed) |
| Deployment  | Docker Compose, managed via Portainer                         |

### Project Structure

```
sgChat-Server/
├── packages/
│   ├── shared/        # Shared types, validators, permissions (bitmask-based)
│   ├── api/           # Fastify backend — routes, socket.io, DB, auth, services
│   │   └── src/
│   │       ├── index.ts       # Entry point — registers all routes, serves SPA
│   │       ├── routes/        # auth, users, servers, channels, messages, dms, friends, voice
│   │       ├── lib/           # db.ts (postgres), redis.ts, storage.ts (minio), bootstrap.ts
│   │       ├── middleware/    # JWT auth middleware
│   │       ├── services/      # permissions.ts, livekit.ts
│   │       ├── socket/        # Socket.IO event handlers
│   │       └── plugins/       # Rate limiting, error handler
│   └── web/           # SolidJS frontend — served by the API container
│       └── src/
│           ├── App.tsx            # Router (/login, /register, /channels/@me, /channels/:id)
│           ├── layouts/           # MainLayout.tsx — main app shell
│           ├── components/layout/ # ServerSidebar, ChatPanel, DMPage, DMSidebar, MemberList
│           ├── components/ui/     # Avatar, VoiceControls, Modals, Settings
│           ├── stores/            # auth, voice, permissions, theme (SolidJS signals)
│           ├── lib/               # socketService, voiceService
│           └── features/auth/     # LoginPage, RegisterPage
├── docker/
│   ├── docker-compose.yml   # Full stack: api, postgres, redis, minio, livekit, ntfy
│   ├── Dockerfile.api       # Builds shared → web → api, serves SPA + API from one container
│   ├── init.sql             # Database schema (all tables, indexes, functions)
│   └── livekit.yaml         # LiveKit config (TURN, ports, Redis)
└── Publishing2Dev.md        # THIS FILE (gitignored)
```

### Key Backend Routes (all under /api)

| Route               | Purpose                                    |
|----------------------|--------------------------------------------|
| `/api/auth`         | Register, login, refresh tokens, admin claim|
| `/api/users`        | Profiles, settings, status, search, block   |
| `/api/server`       | Single-tenant server info, settings, time   |
| `/api/channels`     | Channel CRUD, messages, permissions, voice  |
| `/api/messages`     | Message edit/delete, reactions, read state   |
| `/api/dms`          | DM channels, DM messages (by channel or user ID) |
| `/api/friends`      | Friend requests, accept/reject, friendships |
| `/api/voice`        | LiveKit token generation, voice state       |
| `/api/categories`   | Channel category management                 |
| `/api/upload`       | File uploads (avatars, attachments)         |

### Key Frontend Routes

| Route                    | Component     | Purpose                         |
|--------------------------|---------------|----------------------------------|
| `/channels/@me`          | MainLayout → DMPage | DM view (friend list + chat) |
| `/channels/:channelId`   | MainLayout → ChatPanel | Server channel view        |
| `/channels`              | MainLayout    | Auto-redirects to first channel  |
| `/login`                 | LoginPage     | Auth login                       |
| `/register`              | RegisterPage  | Auth registration                |

### Key Features

- **Auth**: JWT + refresh tokens, admin claim system, auto-login
- **Channels**: Text & voice, categories, topic, permissions, pinned messages
- **Messages**: Real-time, edit/delete, reactions, replies, attachments, typing indicators
- **DMs**: Friend-based DM channels, read receipts, typing indicators
- **Friends**: Send/accept/reject requests, auto-accept mutual, block/unblock
- **Voice**: LiveKit integration, mute/deafen, video, screen share, speaking indicators
- **Permissions**: Bitmask-based (server/text/voice), roles, channel overrides, owner bypass
- **Presence**: Online/idle/dnd/offline, custom status with expiry
- **Theming**: Light/dark/AMOLED, custom CSS, accent colors

### Docker Services

| Service    | Image                        | Port  | Purpose                  |
|------------|------------------------------|-------|--------------------------|
| api        | sosiagaming/sgchat-api:latest| 3040  | API + web client         |
| postgres   | postgres:16-alpine           | 3041  | Database                 |
| redis      | redis:7-alpine               | 3042  | Cache, sessions, voice   |
| minio      | minio/minio:latest           | 3043  | File storage             |
| livekit    | livekit/livekit-server:latest| host  | Voice/video SFU          |
| ntfy       | binwiederhier/ntfy:latest    | 3048  | Push notifications       |


### Known Patterns / Gotchas

- `request.user` (from JWT) only has `id`, `username`, `email`. For full user data
  (avatar_url, display_name, status), you must query `db.users.findById()`.
- Frontend route `/channels/@me` is a literal SolidJS route, NOT a parameterized route.
  `params.channelId` is undefined on this route. Always check `isDMRoute()` before
  making API calls with `channelId`.
- The `channels/:id/messages` backend route expects a valid UUID. Non-UUID values like
  `@me` cause a 400 error (validated with UUID regex).
- Socket events for friend accept must include `display_name`, `avatar_url`, and proper
  `status` (not 'active') — fetched from DB, not JWT.
- LiveKit uses host networking mode. Redis is reached via `localhost:3042` from LiveKit.

---

## Server Details

- **Server OS**: Ubuntu 22.04+
- **Repo location on server**: `/opt/sgchat/repo`
- **Docker compose file**: `/opt/sgchat/repo/docker/docker-compose.yml`
- **Stack managed by**: Portainer (web UI)
- **Docker image name**: `sosiagaming/sgchat-api:latest`
- **Docker Hub account**: `sosiagaming` (login with `docker login` if needed)
- **Container name**: `sgchat-api-1`
- **GitHub repo**: `https://github.com/DemonFiend/sgChat.git`
- **Live URL**: `https://chat.sosiagaming.com`

---

## Deploying Code Changes (Step-by-Step)

PowerShell doesn't support heredoc syntax. Use a simpler commit message format.
PowerShell doesn't support &&. Run commands separately.
After making and committing changes locally in Cursor:

### Step 1: Push to GitHub (from Cursor/local machine)

```bash
cd c:\Users\DemonFiend\Documents\LLMs\VibeCoding\sgChat-Server
git add <changed-files>
git commit -m "description of changes"
git push origin main
```

### Step 2: SSH into the server and pull the latest code

```bash
ssh root@<server-ip>
cd /opt/sgchat/repo
git pull origin main
```

### Step 3: Stop and remove the old API container

```bash
docker stop sgchat-api-1 && docker rm sgchat-api-1
```

### Step 4: Rebuild the Docker image

> **IMPORTANT**: Build directly with the tag `sosiagaming/sgchat-api:latest`.
> Do NOT build as `sgchat-api:latest` and then tag separately — this can cause
> Portainer to use a stale/wrong image.
>
> **IMPORTANT**: Always run from `/opt/sgchat/repo` (the repo root), NOT from
> the `docker/` subdirectory. The Dockerfile needs the full repo as build context.
>
> **IMPORTANT**: Never run `docker compose up -d` from the repo or docker directory.
> This creates a SEPARATE set of containers that conflicts with the Portainer stack.
> Always use Portainer to manage the stack.

```bash
cd /opt/sgchat/repo
docker build --no-cache -t sosiagaming/sgchat-api:latest -f docker/Dockerfile.api .
```

### Step 5: Push the image to Docker Hub

> **IMPORTANT**: Portainer pulls images from Docker Hub when redeploying.
> If you skip this step, Portainer will pull the OLD image from Docker Hub
> and ignore your local build.

```bash
docker push sosiagaming/sgchat-api:latest
```

> If you get an authentication error, run `docker login` first with your
> Docker Hub credentials (username: sosiagaming).

### Step 6: Verify the new image

```bash
docker images | grep sgchat
```

You should see `sosiagaming/sgchat-api:latest` with a recent timestamp and ~392MB size.

### Step 7: Redeploy via Portainer

> **IMPORTANT**: Use **"Redeploy"** (full redeploy), NOT just "Restart".
> Restart reuses the old container. Redeploy pulls the new image from Docker Hub
> and creates a fresh container.

1. Open Portainer in your browser
2. Go to **Stacks** → select the **sgchat** stack
3. Click **Redeploy the stack** (NOT restart — redeploy!)
4. Portainer will pull the new image from Docker Hub and recreate `sgchat-api-1`

### Step 8: Verify the deployment

```bash
# Check container is using the new image (hash should match your build)
docker inspect sgchat-api-1 --format '{{.Image}}'

# Check startup logs — should show all routes registered
docker logs sgchat-api-1 2>&1 | head -15

# Expected startup output:
# ✅ Database connected
# ✅ MinIO connected
# ✅ Server already claimed and configured
# [time] INFO: Server listening at http://0.0.0.0:3000
# [time] INFO: 🚀 sgChat running on http://0.0.0.0:3000
# [time] INFO: 📡 Socket.IO ready for connections
# [time] INFO: 🌐 Web client available at http://0.0.0.0:3000
# [time] INFO: 📋 API available at http://0.0.0.0:3000/api
```

### Step 9: Resetting the Database. 
If the database needs to be reset to take on the new structure/columns/rows ect. Provide docker commmands to restart the Postgres container and then the API Container and then check the Deployment logs again. 

 Part 1: Restart Postgres container. 
 Part 2: Restart API container. 
 Part 3: Print Api Container logs. ( docker logs sgchat-api-1 2>&1 | head -15 )

### Step 10: Hard refresh the browser

Press **Ctrl+Shift+R** (or Ctrl+F5) to clear cached JS bundles and load the new frontend.

---

## Quick Reference (Copy-Paste Commands)

For AI assistants or quick deploys, here's the full sequence to run on the server:

```bash
cd /opt/sgchat/repo
git pull origin main
docker stop sgchat-api-1 && docker rm sgchat-api-1
docker build --no-cache -t sosiagaming/sgchat-api:latest -f docker/Dockerfile.api .
docker push sosiagaming/sgchat-api:latest
# Then go to Portainer and REDEPLOY (not restart) the stack
```

---

## First-Time Setup

### 1. Clone the Repository

```bash
cd /opt/sgchat
git clone https://github.com/DemonFiend/sgChat.git repo
cd repo
```

### 2. Configure Environment Variables

```bash
cp docker/.env.example docker/.env
nano docker/.env
```

### 3. Build and Deploy

Follow the "Deploying Code Changes" steps above starting from Step 4.

### 4. Initialize the Database (first run only)

```bash
docker exec -i sgchat-postgres-1 psql -U sgchat -d sgchat < docker/init.sql
```

### 5. Get the Admin Claim Code

```bash
docker logs sgchat-api-1 --tail 100
```

Look for the "ADMIN CLAIM CODE" box in the logs.

---

## Troubleshooting

### All routes return 404
- The container is running an old image. Follow the full deploy steps above.
- Check `docker inspect sgchat-api-1 --format '{{.Image}}'` matches your latest build.
- Check startup logs for missing `🌐 Web client available` or `📋 API available` lines.
- If those lines are missing, the server crashed during route registration — check full logs.

### Browser shows old code after deploy
- Hard refresh with **Ctrl+Shift+R** to clear cached JS bundles.
- Bundled filenames (e.g., `MainLayout-XXXXXXXX.js`) should change after each rebuild.

### Portainer still uses old image after push
- Verify with `docker pull sosiagaming/sgchat-api:latest` — the hash should match your build.
- Make sure you used **Redeploy**, not Restart.
- If still wrong, stop/remove the container manually, pull, then redeploy.

### "Web client not found" in logs
- The web client wasn't built during docker build. Check for build errors in docker build output.
- Verify with: `docker exec sgchat-api-1 ls -la /app/packages/web/dist/`

### Accidental `docker compose` containers
- If you accidentally ran `docker compose up` from the repo directory, it creates conflicting
  containers. Clean up with:
  ```bash
  cd /opt/sgchat/repo/docker
  docker compose down
  ```
- Then redeploy via Portainer as normal.

### Old image still being used after rebuild
- Remove old images and rebuild:
  ```bash
  docker rmi sosiagaming/sgchat-api:latest 2>/dev/null
  cd /opt/sgchat/repo
  docker build --no-cache -t sosiagaming/sgchat-api:latest -f docker/Dockerfile.api .
  docker push sosiagaming/sgchat-api:latest
  ```

---

## Architecture Notes

- **Portainer** manages the docker-compose stack. Never use `docker compose` CLI for the
  production stack — it creates separate containers that conflict with Portainer's.
- **Portainer pulls from Docker Hub** on redeploy. After building locally on the server,
  you MUST `docker push` to Docker Hub before redeploying in Portainer. Otherwise Portainer
  pulls the old image from Docker Hub and ignores your local build.
- **Redeploy vs Restart**: Always use "Redeploy" in Portainer, never just "Restart".
  Restart reuses the existing container (old image). Redeploy pulls the latest image
  and creates a fresh container.
- The API server serves both the backend API (`/api/*`) and the web client (SPA) from
  the same container. The web client is built during `docker build` and served via `@fastify/static`.
- The docker-compose file references `image: sosiagaming/sgchat-api:latest` — this is the
  image name you must build with and push to Docker Hub.
- **Docker Hub account**: `sosiagaming` (login with `docker login` if needed).
