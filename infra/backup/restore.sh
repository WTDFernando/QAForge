#!/bin/sh
# Restore a QAForge backup into an EMPTY database (never over a live one).
#   ./restore.sh backups/qaforge-20261116T023000Z.dump postgresql://postgres:postgres@localhost:5432/qaforge_restore
set -eu
FILE="${1:?usage: restore.sh <dump file> <target database url>}"
TARGET="${2:?usage: restore.sh <dump file> <target database url>}"

if [ -f "$FILE.sha256" ]; then
  ( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" )
fi
# Extensions first (the dump references them); then the data. --exit-on-error so a partial restore is obvious.
psql "$TARGET" -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;'
pg_restore --no-owner --exit-on-error --dbname="$TARGET" "$FILE"
echo "[restore] done. Point DATABASE_URL at the restored database and run: pnpm --filter @qaforge/db db:deploy"
