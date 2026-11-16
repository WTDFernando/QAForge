# Database backups

Daily `pg_dump` (custom format, compressed) with a SHA-256 checksum and 14-day retention.

## Local / single server (Docker Compose)

```bash
docker compose --profile backup up -d
```

Dumps land in `.data/backups/` at 02:30 UTC every day. Change the time with `BACKUP_AT` and the retention with `BACKUP_RETENTION_DAYS` in `docker-compose.yml`.

To take a backup right now:

```bash
docker compose run --rm --entrypoint sh backup /scripts/backup.sh
```

## Production

Run `backup.sh` from your scheduler (Kubernetes CronJob, systemd timer, cron), with `DATABASE_URL` or the `PG*` variables set and `BACKUP_DIR` pointing to a mounted volume. Copy the dumps off the host as well: sync them to a separate S3 bucket with versioning or object lock. If you use a managed database (RDS, Cloud SQL, Azure), also turn on its point-in-time recovery. These dumps are a second copy, not a replacement for it.

Uploaded files live in S3, not in the database, so turn on bucket versioning there too.

## Restore

Restore into an empty database and check the result before you switch over:

```bash
createdb qaforge_restore
```

```bash
infra/backup/restore.sh .data/backups/qaforge-20261116T023000Z.dump postgresql://postgres:postgres@localhost:5432/qaforge_restore
```

Test a restore at least once a quarter. A backup you have never restored is only a hope.
