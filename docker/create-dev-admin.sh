#!/bin/bash
# Creates a dev admin account after a fresh DB wipe.
# Run from the sgChat-Server root directory after `docker compose up` is healthy.
#
# Usage:
#   bash docker/create-dev-admin.sh
#   bash docker/create-dev-admin.sh --email you@example.com --password mypass --username MyName

set -euo pipefail

COMPOSE_FILE="docker/docker-compose.local.yml"
API_URL="http://localhost:3124"

# Defaults — override with flags
EMAIL="demon@sosiagaming.com"
PASSWORD="123qwe123"
USERNAME="DemonFiend"

while [[ $# -gt 0 ]]; do
  case $1 in
    --email)    EMAIL="$2"; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    --username) USERNAME="$2"; shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

echo "=== Creating dev admin account ==="
echo "  Email:    $EMAIL"
echo "  Username: $USERNAME"
echo ""

# 1. Hash password (sha256 — matches what the client sends)
HASH=$(echo -n "$PASSWORD" | sha256sum | awk '{print $1}')

# 2. Register via API
echo "Registering account..."
RESPONSE=$(curl -sf -X POST "$API_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"email\":\"$EMAIL\",\"password\":\"sha256:$HASH\"}" 2>&1) || {
  # Check if it's a duplicate — try logging in instead
  echo "Registration failed (account may already exist). Trying login..."
  RESPONSE=$(curl -sf -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"sha256:$HASH\"}" 2>&1) || {
    echo "ERROR: Could not register or login. Is the API running at $API_URL?"
    exit 1
  }
}

USER_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$USER_ID" ]; then
  echo "ERROR: Could not extract user ID from response"
  echo "$RESPONSE"
  exit 1
fi
echo "  User ID: $USER_ID"

# 3. Assign Admin role (query server/role IDs dynamically)
echo "Assigning Admin role..."
docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U sgchat -d sgchat_local -c "
  INSERT INTO member_roles (member_user_id, member_server_id, role_id)
  SELECT '$USER_ID', s.id, r.id
  FROM servers s
  JOIN roles r ON r.server_id = s.id AND r.name = 'Admin'
  LIMIT 1
  ON CONFLICT DO NOTHING;
" > /dev/null

echo ""
echo "=== Done! ==="
echo "  $USERNAME ($EMAIL) now has the Admin role."
echo "  Log in at $API_URL"
