#!/bin/bash
# SQLite backup script
# Usage: ./deploy/backup-db.sh
# Add to crontab: 0 3 * * * /app/deploy/backup-db.sh >> /var/log/tactik-backup.log 2>&1

set -euo pipefail

DB_PATH="${DB_PATH:-/app/apps/server/data/pundit.db}"
BACKUP_DIR="${BACKUP_DIR:-/app/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"

if [ ! -f "$DB_PATH" ]; then
  echo "[$(date)] ERROR: Database not found at $DB_PATH"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

DATE=$(date +%Y%m%d_%H%M%S)
DEST="$BACKUP_DIR/pundit_$DATE.db"

# Use SQLite online backup to avoid corruption on live DB
sqlite3 "$DB_PATH" ".backup '$DEST'"

echo "[$(date)] Backup created: $DEST ($(du -sh "$DEST" | cut -f1))"

# Remove backups older than KEEP_DAYS
find "$BACKUP_DIR" -name "pundit_*.db" -mtime "+$KEEP_DAYS" -delete
echo "[$(date)] Cleaned up backups older than $KEEP_DAYS days"
