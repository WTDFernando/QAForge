# @qaforge/db

Prisma schema, migrations and server-side helpers shared by the API and the worker.

| Export                              | Purpose                                                    |
| ----------------------------------- | ---------------------------------------------------------- |
| `getPrisma()`                       | Process-wide client                                        |
| `nextSeq(tx, projectId, kind, n)`   | Per-project IDs (REQ-, TC-, RUN-, BUG-)                    |
| `encryptJson` / `decryptJson`       | AES-256-GCM for secrets at rest (env secrets, org AI keys) |
| `createStorage()`                   | Local disk (dev) or S3 driver; `presign` on S3             |
| `signFileToken` / `verifyFileToken` | Signed download links for the local driver                 |
| `scanBuffer` / `scanningEnabled`    | ClamAV (clamd INSTREAM) client                             |
| `createPerfFixture`                 | 10,000 test case fixture                                   |

## Migrations

`prisma migrate dev` can hang on this setup (advisory lock). To add a migration, generate the SQL and deploy it:

```bash
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" --script > prisma/migrations/<timestamp>_<name>/migration.sql
pnpm db:deploy
```

Raw SQL indexes (trigram) are declared in the schema so `migrate diff` stays clean.

## Data

```bash
pnpm db:seed          # demo org, users (password qaforge-demo-1), Payments project with runs and bugs
pnpm db:perf-fixture  # PERF project with 10,000 test cases
```
