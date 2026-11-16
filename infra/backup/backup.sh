#!/bin/sh
# Daily PostgreSQL backup for QAForge.
#   Connection: standard libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE) or DATABASE_URL.
#   BACKUP_DIR             where dumps go (default ./backups)
#   BACKUP_RETENTION_DAYS  delete dumps older than this (default 14)
# Output: custom-format dump (compressed, restorable table by table) + SHA-256 checksum.
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_ARG="${DATABASE_URL:-}"
NAME="qaforge-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"
TMP="$BACKUP_DIR/.${NAME}.partial"
trap 'rm -f "$TMP"' EXIT

echo "[backup] $(date -u +%FT%TZ) dumping to $BACKUP_DIR/$NAME"
if [ -n "$DB_ARG" ]; then
  pg_dump --format=custom --compress=6 --no-owner --file="$TMP" "$DB_ARG"
else
  pg_dump --format=custom --compress=6 --no-owner --file="$TMP"
fi

# Sanity check: the archive must list its contents, otherwise keep the previous backups untouched.
pg_restore --list "$TMP" > /dev/null
mv "$TMP" "$BACKUP_DIR/$NAME"
trap - EXIT
( cd "$BACKUP_DIR" && sha256sum "$NAME" > "$NAME.sha256" )
echo "[backup] ok: $(du -h "$BACKUP_DIR/$NAME" | cut -f1)"

# Retention: only our own files, only after a successful dump.
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'qaforge-*.dump' -o -name 'qaforge-*.dump.sha256' \) \
  -mtime +"$RETENTION" -print -delete | sed 's/^/[backup] removed /'
