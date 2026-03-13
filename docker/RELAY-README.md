# sgChat Voice Relay Server

A voice relay server offloads voice, video, and screen sharing traffic from the main sgChat server to a separate machine. This reduces latency for users in different regions and distributes media processing load.

All media types (voice, video, screen share) route through the relay when assigned -- the relay runs its own LiveKit SFU instance.

---

## How It Works

1. **Master creates a relay** -- generates a one-time setup token
2. **Relay starts with the token** -- auto-detects its public IP, generates its own LiveKit credentials, and pairs with Master via an ECDH cryptographic handshake
3. **Relay becomes trusted** -- Master begins health-checking it every 15 seconds
4. **Voice channels can be assigned** -- via the channel settings Region dropdown (Main Server / Automatic / specific relay)
5. **Clients measure latency** -- the web client pings all relays every 5 minutes and reports results to Master for automatic relay selection

---

## Recommended Specs

The relay's `max_participants` defaults to **200** (Tier 2). This is the recommended starting point -- it can comfortably handle multiple active voice channels simultaneously. Adjust when creating the relay if your needs differ.

### Tier 1 -- Small (1-99 concurrent users)

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Bandwidth | 100 Mbps | 250 Mbps |
| Storage | 1 GB | 1 GB |

Budget-friendly option for small communities or testing. A $4-6/mo VPS from Hetzner, Vultr, DigitalOcean, or similar. Handles 1-2 active voice channels comfortably, or a single channel with video/screen sharing.

- ~40-50 voice-only participants
- ~8-10 video (720p) participants
- ~5 screen share participants

### Tier 2 -- Medium (100-249 concurrent users) -- Recommended Default

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Bandwidth | 250 Mbps | 500 Mbps |
| Storage | 1 GB | 1 GB |

**This is the recommended minimum spec for a production relay.** Handles multiple active voice channels with mixed voice + video workloads. Enough headroom for a few concurrent channels with screen sharing or video alongside regular voice traffic.

- ~200 voice-only participants across multiple channels
- ~20-40 video (720p) participants
- ~15-25 screen share participants

### Tier 3 -- Large (250-500+ concurrent users)

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 vCPU | 8 vCPU |
| RAM | 8 GB | 16 GB |
| Bandwidth | 500 Mbps | 1 Gbps |
| Storage | 1 GB | 1 GB |

For large-scale usage, deploy **multiple relays** across regions. The automatic relay selection distributes users to the lowest-latency relay. Each relay handles up to its `max_participants` limit -- set this when creating the relay to match your hardware.

### Resource Usage Per Participant

| Media Type | CPU per User | RAM per User |
|------------|-------------|-------------|
| Voice only | ~0.02 cores | ~5 MB |
| Video (720p) | ~0.1-0.2 cores | ~30-50 MB |
| Screen share | ~0.1-0.2 cores | ~30-50 MB |
| Video (1080p) | ~0.2-0.4 cores | ~50-80 MB |

### Network Ports Required

| Port | Protocol | Purpose |
|------|----------|---------|
| 3100 | TCP | Relay API (health checks, voice authorize) |
| 7880 | TCP | LiveKit signaling (WebSocket) |
| 50000-50100 | UDP | LiveKit WebRTC media (voice/video/screen) |

Ensure these ports are open in your firewall and/or cloud security group.

---

## Deployment with Docker Compose (Recommended)

### Prerequisites

- A Linux server with Docker and Docker Compose installed
- Network access to the Master sgChat server
- Ports 3100 (TCP), 7880 (TCP), and 50000-50100 (UDP) open

### Step 1: Generate the Setup Token (on Master)

SSH into your **Master sgChat server** and run:

```bash
docker exec sgchat-api-1 node dist/cli/create-relay.js --name "US-East" --region "us-east"
```

Replace `"US-East"` with a display name and `"us-east"` with a region identifier.

This outputs something like:

```
Relay "US-East" created (region: us-east)
Token expires: 2026-03-14T12:00:00.000Z

Paste this into the relay .env file:

RELAY_SETUP_TOKEN=eyJyZWxheV9pZCI6IjU1Y...longbase64string...
```

Copy the `RELAY_SETUP_TOKEN=...` line. The token expires in 24 hours.

### Step 2: Set Up the Relay Server

SSH into your **relay server** and create a directory:

```bash
mkdir -p ~/sgchat-relay && cd ~/sgchat-relay
```

### Step 3: Download the Docker Compose File

Copy `docker-compose.relay.yml` from the sgChat repository to your relay server. You can either:

**Option A** -- Download directly:
```bash
curl -O https://raw.githubusercontent.com/DemonFiend/sgChat/main/docker/docker-compose.relay.yml
```

**Option B** -- Create it manually:
```bash
cat > docker-compose.relay.yml << 'EOF'
services:
  livekit:
    image: livekit/livekit-server:latest
    network_mode: host
    volumes:
      - relay-data:/data:ro
    command: ["--config", "/data/livekit.yaml"]
    restart: unless-stopped

  relay:
    image: sosiagaming/sgchat-relay:latest
    network_mode: host
    volumes:
      - relay-data:/data
    environment:
      - RELAY_SETUP_TOKEN=${RELAY_SETUP_TOKEN}
    restart: unless-stopped

volumes:
  relay-data:
EOF
```

### Step 4: Create the Environment File

```bash
cat > .env << 'EOF'
RELAY_SETUP_TOKEN=<paste your token here>
EOF
```

Replace `<paste your token here>` with the full token from Step 1.

### Step 5: Start the Relay

```bash
docker compose up -d
```

### Step 6: Verify

Check the relay logs:

```bash
docker compose logs -f relay
```

You should see:
```
=== sgChat Relay Server ===
Detecting public IP...
Public IP: 203.0.113.50
First boot: generating LiveKit credentials...
LiveKit config written to /data/livekit.yaml
Health URL: http://203.0.113.50:3100/health
LiveKit URL: ws://localhost:7880
===========================
sgChat Relay listening on 0.0.0.0:3100
Pairing token detected -- auto-pairing with Master...
  Decoding pairing token...
  Relay: "US-East" (us-east)
  Master URL: https://chat.sosiagaming.com
  Generating ECDH keypair...
  Pairing with Master...
  Relay "US-East" paired successfully.
```

Check that LiveKit also started:

```bash
docker compose logs livekit
```

The relay should now appear as **trusted** in the Master's admin panel (Server Settings > Relay Servers).

### Step 7: Assign a Voice Channel

In the sgChat web client:
1. Right-click a voice channel > **Channel Settings**
2. Under **Region**, select your relay or **Automatic (best relay)**
3. Click **Save Changes**

---

## Deployment with Docker (Without Compose)

If you prefer to run containers individually:

### Step 1: Generate Setup Token

Same as above -- run on the Master server:

```bash
docker exec sgchat-api-1 node dist/cli/create-relay.js --name "US-East" --region "us-east"
```

### Step 2: Create a Shared Volume

```bash
docker volume create sgchat-relay-data
```

### Step 3: Start the Relay Container

```bash
docker run -d \
  --name sgchat-relay \
  --network host \
  -v sgchat-relay-data:/data \
  -e RELAY_SETUP_TOKEN="<paste your token here>" \
  --restart unless-stopped \
  sosiagaming/sgchat-relay:latest
```

Wait a few seconds for the relay to write the LiveKit config:

```bash
docker logs sgchat-relay
```

Confirm you see `"LiveKit config written to /data/livekit.yaml"` before proceeding.

### Step 4: Start the LiveKit Container

```bash
docker run -d \
  --name sgchat-relay-livekit \
  --network host \
  -v sgchat-relay-data:/data:ro \
  --restart unless-stopped \
  livekit/livekit-server:latest \
  --config /data/livekit.yaml
```

### Step 5: Verify

```bash
docker logs sgchat-relay
docker logs sgchat-relay-livekit
```

---

## Management

### View Relay Status

In the sgChat web client, go to **Server Settings > Relay Servers** to see all relays with their health status, participant count, and region.

### Restart the Relay

```bash
cd ~/sgchat-relay
docker compose restart
```

The relay persists its config in the Docker volume. It does **not** need the setup token after the first successful pairing -- it reconnects using saved credentials.

### Update the Relay

```bash
cd ~/sgchat-relay
docker compose pull
docker compose up -d
```

### Remove the Relay

On the relay server:
```bash
cd ~/sgchat-relay
docker compose down -v
```

On the Master, either:
- Delete via the admin panel (Server Settings > Relay Servers)
- Or: `docker exec sgchat-api-1 ...` (use the admin API)

### Drain a Relay (Graceful Shutdown)

To stop routing new users to a relay while letting existing sessions finish:
1. In Server Settings > Relay Servers, click **Drain** on the relay
2. Wait for current participants to leave (monitored via heartbeats)
3. The relay transitions to `offline` once empty
4. Then you can safely stop or update it

---

## Troubleshooting

### Relay won't pair

- **Token expired**: Tokens are valid for 24 hours. Generate a new one on the Master.
- **Master unreachable**: Ensure the relay can reach the Master's URL (check firewall, DNS).
- **Already paired**: If the relay was previously paired, its config is saved in the volume. Delete the volume to re-pair: `docker compose down -v`

### Health checks failing

- **Port 3100 not open**: Ensure the firewall allows TCP 3100 from the Master server.
- **Wrong public IP**: If behind NAT or using a proxy, set `PUBLIC_IP` manually in your `.env`:
  ```
  RELAY_SETUP_TOKEN=eyJ...
  PUBLIC_IP=203.0.113.50
  ```
  Or set `RELAY_HEALTH_URL` directly:
  ```
  RELAY_HEALTH_URL=http://203.0.113.50:3100/health
  ```

### Voice not connecting through relay

- **Ports 50000-50100 (UDP) not open**: LiveKit needs these for WebRTC media.
- **Port 7880 (TCP) not open**: LiveKit needs this for WebSocket signaling.
- **Channel not assigned**: Check the voice channel's Region setting -- it defaults to "Main Server".

### LiveKit container restarting

This is normal on first boot -- LiveKit starts before the relay writes `livekit.yaml`. It will stabilize after 1-2 restarts (10-20 seconds).

---

## Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RELAY_SETUP_TOKEN` | Yes (first boot) | -- | One-time pairing token from Master |
| `PUBLIC_IP` | No | Auto-detected | Override public IP for health URL |
| `RELAY_HEALTH_URL` | No | `http://{PUBLIC_IP}:3100/health` | Full override for health endpoint URL |
| `RELAY_PORT` | No | `3100` | Relay API listen port |
| `RELAY_HOST` | No | `0.0.0.0` | Relay API bind address |
| `LIVEKIT_URL` | No | `ws://localhost:7880` | URL to reach the relay's LiveKit instance |
| `LIVEKIT_API_KEY` | No | Auto-generated | Override LiveKit API key |
| `LIVEKIT_API_SECRET` | No | Auto-generated | Override LiveKit API secret |

Most users only need `RELAY_SETUP_TOKEN`. Everything else has sensible defaults.

---

## Architecture

```
  Users (Browser/Desktop)
         |
         |-- REST API, WebSocket ------> Master Server (sgChat API)
         |                                    |
         '-- WebRTC (voice/video) --> Relay Server
                                        |-- sgchat-relay (Node.js)
                                        |     |-- Health endpoint (/health)
                                        |     |-- Voice authorize (/voice-authorize)
                                        |     |-- Heartbeat -> Master (every 15s)
                                        |     '-- Permission cache (offline auth, 10min TTL)
                                        |
                                        '-- LiveKit SFU
                                              |-- WebSocket signaling (port 7880)
                                              '-- WebRTC media (ports 50000-50100 UDP)
```

The relay handles **only media traffic**. All chat messages, presence, permissions, and other real-time events still go through the Master server's Socket.IO connection.
