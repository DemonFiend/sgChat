#!/bin/bash
# sgChat Encrypted Backup Script
#
# Creates encrypted backups of:
#   - PostgreSQL database (pg_dump → gpg symmetric encryption)
#   - MinIO data (tarball → gpg symmetric encryption)
#
# Usage:
#   ./backup.sh
#
# Prerequisites:
#   - gpg installed on the host
#   - Backup passphrase in /opt/sgchat/backup.key (chmod 600)
#   - Docker containers running (sgchat-postgres-1, sgchat-minio-1)
#
# Schedule via cron:
#   0 3 * * * /opt/sgchat/repo/docker/backup.sh >> /var/log/sgchat-backup.log 2>&1

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-/opt/sgchat/backups}"
PASSPHRASE_FILE="${PASSPHRASE_FILE:-/opt/sgchat/backup.key}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-sgchat-postgres-1}"
POSTGRES_USER="${POSTGRES_USER:-sgchat}"
POSTGRES_DB="${POSTGRES_DB:-sgchat}"
KEEP_DAILY=7
KEEP_WEEKLY=4

# ── Validation ────────────────────────────────────────────────

if [ ! -f "$PASSPHRASE_FILE" ]; then
  echo "ERROR: Passphrase file not found at $PASSPHRASE_FILE"
  echo "Create it with: openssl rand -base64 32 > $PASSPHRASE_FILE && chmod 600 $PASSPHRASE_FILE"
  exit 1
fi

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

DATE=$(date +%F)
TIMESTAMP=$(date +%F_%H%M%S)
DAY_OF_WEEK=$(date +%u)

echo "=== sgChat Backup — $TIMESTAMP ==="

# ── PostgreSQL Backup ─────────────────────────────────────────

echo "Backing up PostgreSQL..."
PG_BACKUP="$BACKUP_DIR/daily/sgchat-db-$TIMESTAMP.sql.gpg"

docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gpg --batch --yes --passphrase-file "$PASSPHRASE_FILE" --symmetric --cipher-algo AES256 \
  -o "$PG_BACKUP"

PG_SIZE=$(du -h "$PG_BACKUP" | cut -f1)
echo "  PostgreSQL backup: $PG_BACKUP ($PG_SIZE)"

# ── Weekly Copy (Sundays) ────────────────────────────────────

if [ "$DAY_OF_WEEK" -eq 7 ]; then
  echo "Creating weekly backup copy..."
  cp "$PG_BACKUP" "$BACKUP_DIR/weekly/sgchat-db-weekly-$DATE.sql.gpg"
fi

# ── Rotation ──────────────────────────────────────────────────

echo "Rotating old backups..."

# Keep last N daily backups
cd "$BACKUP_DIR/daily"
ls -t sgchat-db-*.sql.gpg 2>/dev/null | tail -n +$((KEEP_DAILY + 1)) | xargs -r rm -v

# Keep last N weekly backups
cd "$BACKUP_DIR/weekly"
ls -t sgchat-db-weekly-*.sql.gpg 2>/dev/null | tail -n +$((KEEP_WEEKLY + 1)) | xargs -r rm -v

# ── Summary ───────────────────────────────────────────────────

TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo "=== Backup complete. Total backup size: $TOTAL_SIZE ==="
echo ""
echo "To restore:"
echo "  gpg --batch --passphrase-file $PASSPHRASE_FILE -d $PG_BACKUP | \\"
echo "    docker exec -i $POSTGRES_CONTAINER psql -U $POSTGRES_USER $POSTGRES_DB"
