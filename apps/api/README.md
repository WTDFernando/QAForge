# @qaforge/api

NestJS 11 REST API: the only service that reads and writes the database. OpenAPI at `/docs` and `/openapi.json`.

## Run

```bash
pnpm --filter @qaforge/api dev     # http://localhost:4000
```

Configuration is validated at start-up (`src/config/env.ts`). See `.env.example` for every variable.

## How a request is handled

1. `helmet`, CORS for `WEB_URL`, Redis rate limiting (`src/common/rate-limit.ts`): sign-in per IP, AI per user, everything else per user.
2. Better Auth (`/api/auth/*`) sets the session cookie.
3. `AuthGuard` requires a session unless the route is `@Public()`.
4. `PermissionGuard` resolves the membership from `:orgId` or `:projectId` and applies the project role override. Non-members get **404**, so the API never confirms that something exists.
5. Every mutation calls `AuditService.record(tx, actor, entry)` inside the same Prisma transaction.

## Modules

| Module                                   | Routes                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| organizations, projects, project members | orgs, invitations, members, per-project roles                                                  |
| requirements, test-cases, suites, views  | repository, versions, bulk actions, exports                                                    |
| test-runs                                | runs, results (snapshots), assignment                                                          |
| bugs, comments, notifications            | bug workflow, Kanban rank, uploads with annotations, comments with mentions, notification bell |
| ai                                       | settings (master switch, key, budget), agent jobs (+ SSE stream), QA Copilot                   |
| storage                                  | signed file URLs (`/v1/files/:id`), malware-scan gate                                          |
| dashboard, audit, health                 |                                                                                                |

## Files

Uploads go through `AttachmentsService.store` (type allow-list, 25 MB limit, SHA-256, scan status). Downloads are short-lived signed URLs: HMAC-signed `/v1/files/:id` for local disk, presigned S3 URLs in production. A file is unusable while its scan is `PENDING`, `INFECTED` or `FAILED`.

## Tests

`pnpm --filter @qaforge/api test` runs the integration suites against `qaforge_test` (migrated automatically) and Redis. `src/perf.e2e.test.ts` builds a 10,000-case fixture and checks list response times.
