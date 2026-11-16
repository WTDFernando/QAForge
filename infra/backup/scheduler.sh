#!/bin/sh
# Runs backup.sh once a day at BACKUP_AT (UTC, HH:MM). Used by the compose "backup" profile;
# in Kubernetes or a VM use a CronJob / cron entry that calls backup.sh directly instead.
set -eu
AT="${BACKUP_AT:-02:30}"
echo "[scheduler] daily backup at ${AT} UTC"
while true; do
  now=$(date -u +%s)
  target=$(date -u -d "$(date -u +%F) ${AT}" +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  sleep $((target - now))
  sh /scripts/backup.sh || echo "[scheduler] backup FAILED (will retry tomorrow)" >&2
done
