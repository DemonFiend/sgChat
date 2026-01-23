# VoxCord - Portainer Deployment Guide

## Your Configuration
- **Domain:** chat.sosiagaming.com
- **Server IP:** 192.168.2.23 (LAN)
- **Port Range:** 3040-3049

## Port Mappings
- **3040** - API Server (REST + WebSocket)
- **3041** - PostgreSQL (internal, can close externally)
- **3042** - Redis (internal, can close externally)  
- **3043** - MinIO S3 API
- **3044** - MinIO Console
- **3045** - LiveKit WebSocket
- **3046** - LiveKit WebRTC TCP
- **3047** - LiveKit WebRTC UDP (MUST allow in firewall)
- **3048** - ntfy (Push notifications)
- **3049** - Nginx (Web client HTTP)
- **3050** - Nginx (Web client HTTPS)

## Step 1: Prepare Your Server

### Firewall Configuration
```bash
# Allow the port range
sudo ufw allow 3040:3050/tcp
sudo ufw allow 3047/udp  # LiveKit WebRTC UDP
sudo ufw enable
sudo ufw status
```

### DNS Configuration
Point `chat.sosiagaming.com` to your server's public IP (or 192.168.2.23 for LAN-only).

## Step 2: Generate Secrets

Before deploying, generate strong secrets:

```bash
# Generate JWT secrets (run these commands)
openssl rand -base64 64
openssl rand -base64 64

# Generate LiveKit keys
openssl rand -hex 16  # API Key
openssl rand -base64 32  # API Secret
```

## Step 3: Deploy in Portainer

### Option A: Using Portainer Stack (Recommended)

1. **Login to Portainer** at http://192.168.2.23:9000
2. Click **Stacks** → **Add Stack**
3. **Name:** `voxcord`
4. **Build method:** Choose "Web editor"
5. **Paste the contents of `docker-compose.yml`** into the editor

6. **Add Environment Variables** (scroll down):

Click "Add environment variable" for each:

```
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

JWT_SECRET=<paste your first openssl output>
JWT_REFRESH_SECRET=<paste your second openssl output>
CORS_ORIGIN=https://chat.sosiagaming.com

DATABASE_URL=postgresql://voxcord:YOUR_DB_PASSWORD@postgres:5432/voxcord
POSTGRES_USER=voxcord
POSTGRES_PASSWORD=<create strong password>
POSTGRES_DB=voxcord

REDIS_URL=redis://redis:6379

LIVEKIT_API_KEY=<your generated key>
LIVEKIT_API_SECRET=<your generated secret>
LIVEKIT_URL=wss://chat.sosiagaming.com:3045

MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=voxcord_admin
MINIO_SECRET_KEY=<create strong password>

NTFY_BASE_URL=http://192.168.2.23:3048
```

7. **Enable "Access control"** - Leave default (Administrators)
8. Click **Deploy the stack**

### Option B: Using .env File

If you prefer, you can create a `.env` file on the server:

1. SSH into your server
2. Create directory: `mkdir -p /opt/voxcord/docker`
3. Copy files:
   ```bash
   # Copy docker-compose.yml, init.sql, livekit.yaml to /opt/voxcord/docker/
   ```
4. Create `.env` from `.env.example`:
   ```bash
   cd /opt/voxcord/docker
   cp .env.example .env
   nano .env  # Edit with your values
   ```
5. In Portainer, use "Upload from file" and select the docker-compose.yml

## Step 4: Verify Deployment

### Check Container Status
In Portainer:
- Go to **Stacks** → **voxcord**
- All 7 containers should show as "running" (green)
- Check logs if any are failing

### Test Services
```bash
# API Health
curl http://192.168.2.23:3040/health

# PostgreSQL
docker exec -it voxcord-postgres-1 psql -U voxcord -d voxcord -c "SELECT 1;"

# Redis
docker exec -it voxcord-redis-1 redis-cli ping

# MinIO
curl http://192.168.2.23:3043/minio/health/live
```

## Step 5: Access Services

- **API:** http://192.168.2.23:3040/api
- **MinIO Console:** http://192.168.2.23:3044
- **Web Client:** http://192.168.2.23:3049
- **Push Notifications:** http://192.168.2.23:3048

## Step 6: Setup Reverse Proxy (Production)

For production with SSL, setup Caddy or Nginx Proxy Manager:

### Using Caddy (Recommended)
```bash
docker run -d \
  --name caddy \
  --network voxcord_voxcord \
  -p 80:80 \
  -p 443:443 \
  -v caddy_data:/data \
  -v /opt/voxcord/Caddyfile:/etc/caddy/Caddyfile \
  caddy:latest
```

**Caddyfile:**
```
chat.sosiagaming.com {
    reverse_proxy api:3000
}

chat.sosiagaming.com:3045 {
    reverse_proxy livekit:7880
}
```

## Troubleshooting

### API won't start
- Check logs: `docker logs voxcord-api-1`
- Verify database is healthy
- Check JWT_SECRET is set

### Database connection errors
- Ensure POSTGRES_PASSWORD matches in all places
- Check postgres container is running
- Verify DATABASE_URL format

### LiveKit connection issues
- Port 3047 UDP must be open in firewall
- Check LIVEKIT_API_KEY and LIVEKIT_API_SECRET match

### Build failures
- The API container builds from source
- First deployment takes 5-10 minutes
- Check build logs in Portainer

## Important Notes

1. **First deployment** will take longer as it builds the API image
2. **PostgreSQL init.sql** runs only on first start (creates tables)
3. **Data persists** in Docker volumes even if containers restart
4. **Backup volumes** regularly:
   ```bash
   docker run --rm -v voxcord_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres-backup.tar.gz /data
   ```

## Next Steps

1. Create an admin account via API
2. Setup SSL certificates (Let's Encrypt via Caddy)
3. Configure LiveKit for your domain
4. Build and deploy the Tauri desktop client
5. Test voice/video calls

## Support

If you encounter issues:
- Check Portainer container logs
- Verify all environment variables are set
- Ensure ports are accessible
- Review Docker compose service dependencies
