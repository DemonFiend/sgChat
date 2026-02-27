# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
pnpm install              # Install all dependencies
pnpm dev                  # Start API dev server (tsx watch, port 3000)
pnpm dev:web              # Start web client dev server (Vite, port 5174)
pnpm dev:all              # Start both API and web dev servers
pnpm build                # Build all packages (shared → web → api)
pnpm build:web            # Build web client only
pnpm build:api            # Build shared + API only
pnpm typecheck            # Type check all packages
pnpm lint                 # ESLint across all packages
pnpm format               # Prettier format all files
```

Build order matters: `shared` must build before `api` or `web` (it exports types/validators used by both).

## Architecture

**Monorepo** (pnpm workspaces) with three packages:

- **`packages/shared`** — Types, Zod validators, permission enums, constants. Published as `@sgchat/shared`, imported by both API and web.
- **`packages/api`** — Fastify HTTP server + Socket.IO real-time. Serves the built web client from `packages/web/dist/` as static files with SPA fallback.
- **`packages/web`** — SolidJS frontend (not React). Built with Vite + Tailwind CSS 4. Uses SolidJS Signals for state (not hooks/useState).

### Backend (API)

**Entry point**: `packages/api/src/index.ts` — bootstraps Fastify, registers plugins, mounts routes, starts Socket.IO.

**Request flow**: Routes (`routes/*.ts`) → middleware auth → service logic (`services/*.ts`) → database (`lib/db.ts` using postgres.js tagged templates) → event bus (`lib/eventBus.ts`) → Socket.IO broadcast.

**Key libraries**:
- `postgres.js` for SQL (raw tagged templates, no ORM)
- Redis for sessions, presence, voice state, caching
- MinIO for file storage and message archiving
- LiveKit for voice/video SFU
- ntfy for push notifications

**Routes are dual-registered** at both `/api/*` (standard) and root `/` (legacy). When adding new routes, register under `/api/`.

**Auth**: JWT access token in `Authorization` header + httpOnly refresh cookie. Use `authenticate()` middleware for protected routes, `optionalAuth()` for optional.

### Real-time (Socket.IO)

All events use an **envelope system** with type, resourceId, sequence, and actor fields. The event bus (`lib/eventBus.ts`) is the central pub/sub — routes/services publish events, Socket.IO subscribes and broadcasts to rooms (`user:*`, `server:*`, `channel:*`, `dm:*`).

**Gateway protocol**: `gateway.hello` → `gateway.ready` → heartbeat (30s interval, 45s timeout). Supports `gateway.resume` for reconnection with sequence-based gap detection and resync via `/gateway/resync` REST endpoint.

### Frontend (Web)

**SolidJS, not React** — no virtual DOM, no hooks. Components use Signals and createEffect/createMemo. State lives in store files under `stores/` using SolidJS primitives.

**Path aliases**: `@/*` maps to `src/*` (e.g., `@/components/*`, `@/stores/*`, `@/lib/*`, `@/api/*`).

**Key stores**: `authStore` (login/tokens), `networkStore` (multi-server discovery), `serverConfigStore` (channels/members/roles), `permissionStore` (calculated permissions).

**API client**: Custom fetch wrapper in `lib/` with auth header injection. Base URL determined by `networkStore` for multi-server support.

### Permissions

Bitflag-based system using BigInt. Calculation order: owner bypass → timeout check → @everyone role → user roles (OR'd together) → channel overrides (allow/deny). `ADMINISTRATOR` flag bypasses all checks. Three permission categories: server, text, voice.

### Database

PostgreSQL 16 with pg_cron. Schema defined in `docker/init.sql` (source of truth for fresh DBs). No automated migration runner — migrations in `packages/api/src/migrations/` are applied manually:

```bash
docker exec -it sgchat-postgres-1 psql -U sgchat -d sgchat < migration.sql
```

## Deployment

Docker Compose stack deployed via Portainer on Ubuntu. Services: api (port 3040), postgres (3041), redis (3042), minio (3043), livekit (host network), ntfy (3048).

- Production URL: `chat.sosiagaming.com`
- DockerHub images: `sosiagaming/sgchat-api:latest`, `sosiagaming/sgchat-postgres:latest`
- Config template: `docker/.env.example`

## Code Conventions

- TypeScript strict mode, ESM imports everywhere
- Prettier enforced: 100-char lines, trailing commas, semicolons
- Database queries use postgres.js tagged template syntax: `` sql`SELECT * FROM users WHERE id = ${id}` ``
- Frontend components are `.tsx`, backend is `.ts`
- No automated test suite exists — validate changes with `pnpm typecheck` and `pnpm lint`
