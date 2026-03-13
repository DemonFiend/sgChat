#!/bin/sh
set -e

DATA_DIR="/data"
CREDS_FILE="$DATA_DIR/livekit-creds.json"
LIVEKIT_CONFIG="$DATA_DIR/livekit.yaml"
RELAY_PORT="${RELAY_PORT:-3100}"

echo "=== sgChat Relay Server ==="

# ── 1. Auto-detect public IP ────────────────────────────────

if [ -z "$PUBLIC_IP" ]; then
  echo "Detecting public IP..."
  PUBLIC_IP=$(curl -sf --max-time 5 https://ifconfig.me 2>/dev/null) || \
  PUBLIC_IP=$(curl -sf --max-time 5 https://api.ipify.org 2>/dev/null) || \
  PUBLIC_IP=$(curl -sf --max-time 5 https://checkip.amazonaws.com 2>/dev/null) || \
  true

  if [ -z "$PUBLIC_IP" ]; then
    echo "WARNING: Could not auto-detect public IP."
    echo "Set PUBLIC_IP or RELAY_HEALTH_URL in your environment."
    PUBLIC_IP="127.0.0.1"
  fi
fi

echo "Public IP: $PUBLIC_IP"
export PUBLIC_IP

# ── 2. Generate or load LiveKit credentials ──────────────────

if [ ! -f "$CREDS_FILE" ]; then
  echo "First boot: generating LiveKit credentials..."

  LK_API_KEY="relay-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  LK_API_SECRET="secret-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

  cat > "$CREDS_FILE" <<CREDS_EOF
{"api_key":"$LK_API_KEY","api_secret":"$LK_API_SECRET"}
CREDS_EOF

  echo "LiveKit credentials saved to $CREDS_FILE"
else
  echo "Loading existing LiveKit credentials..."
fi

# Parse credentials from JSON (portable, no jq dependency)
LK_API_KEY=$(sed 's/.*"api_key":"\([^"]*\)".*/\1/' "$CREDS_FILE")
LK_API_SECRET=$(sed 's/.*"api_secret":"\([^"]*\)".*/\1/' "$CREDS_FILE")

# ── 3. Write LiveKit config ─────────────────────────────────

cat > "$LIVEKIT_CONFIG" <<LK_EOF
port: 7880
rtc:
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: true
keys:
  $LK_API_KEY: $LK_API_SECRET
LK_EOF

echo "LiveKit config written to $LIVEKIT_CONFIG"

# ── 4. Set environment for relay process ─────────────────────

export LIVEKIT_API_KEY="$LK_API_KEY"
export LIVEKIT_API_SECRET="$LK_API_SECRET"
export LIVEKIT_URL="${LIVEKIT_URL:-ws://localhost:7880}"
export RELAY_HOST="${RELAY_HOST:-0.0.0.0}"
export RELAY_PORT="$RELAY_PORT"
export RELAY_CONFIG_PATH="${RELAY_CONFIG_PATH:-$DATA_DIR/relay-config.json}"

if [ -z "$RELAY_HEALTH_URL" ]; then
  export RELAY_HEALTH_URL="http://$PUBLIC_IP:$RELAY_PORT/health"
fi

# The setup token IS the pairing token
if [ -n "$RELAY_SETUP_TOKEN" ] && [ -z "$RELAY_PAIRING_TOKEN" ]; then
  export RELAY_PAIRING_TOKEN="$RELAY_SETUP_TOKEN"
fi

echo "Health URL: $RELAY_HEALTH_URL"
echo "LiveKit URL: $LIVEKIT_URL"
echo "==========================="

# ── 5. Start relay ───────────────────────────────────────────

exec node dist/cli.js start
