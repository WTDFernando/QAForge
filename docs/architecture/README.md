# QAForge architecture: final structure and data model (proposal for review)

Status: **proposal, waiting for product owner review.** No feature code for the next phase is written until this is approved.

- Full schema: [`schema.proposed.prisma`](schema.proposed.prisma) (validated with `prisma validate`; 50 models). Live schema today: [`packages/db/prisma/schema.prisma`](../../packages/db/prisma/schema.prisma) (25 models).
- Each model is tagged **[EXISTS]** (unchanged), **[CHANGED]** (fields added), or **[NEW]**.

## 1. Build plan (prompt 3) vs. what exists

| Plan phase              | Scope                                                                                        | Status                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 Foundation**        | Monorepo, Docker Compose, auth + RBAC, orgs/projects, shell + Ctrl+K, CI, seed               | ✅ Built. Compose runs Postgres + Redis; files use local disk in dev / S3 in prod (approved replacement for MinIO, whose Docker image was removed). |
| **1 Core QA**           | Requirements, test cases, **test runs**, **bugs**, traceability, dashboard                   | ✅ Requirements, test cases, traceability (req ↔ TC), dashboard. ⏳ **Test runs, bugs**                                                             |
| **2 AI agents**         | Framework, Requirement, Writer, Reviewer, **Bug Agent**, review queue, usage                 | ✅ All except ⏳ **Bug Agent** (needs bugs)                                                                                                         |
| 3 Automation            | API testing, Playwright runner, schedules, CI webhooks, Automation + Failure Analysis agents | ⏳                                                                                                                                                  |
| 4 Releases & reports    | Releases, gates, approvals, reports, exports, share links, Report Agent                      | ⏳                                                                                                                                                  |
| 5 Integrations & polish | Jira/GitLab sync, Slack/Teams, public API + webhooks + MCP, Copilot, perf, onboarding wizard | ✅ QA Copilot (built early). ⏳ rest                                                                                                                |
| 6+ Future               | k6, ZAP, axe, visual                                                                         | Nav slots + feature flags exist                                                                                                                     |

**Proposed next phase: "Phase 1 completion"**: test runs, bugs, test case ↔ bug traceability, the Bug Agent, and the NFR hardening listed in §5 for everything built so far.

## 2. Final folder structure

`✓` exists today · `+` added in a later phase (phase number in brackets)

```text
qaforge/
├── apps/
│   ├── web/                         ✓ Next.js 16 (App Router)
│   │   ├── README.md                + [next] per-app README (NFR)
│   │   ├── e2e/                     ✓ Playwright: core, qa, ai, a11y specs  (+ runs, bugs, …)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── (auth)/          ✓ login, signup
│   │       │   ├── (app)/
│   │       │   │   ├── onboarding/  ✓ (+ wizard [5])
│   │       │   │   ├── invite/[id]/ ✓
│   │       │   │   └── [org]/
│   │       │   │       ├── settings/    ✓ general, members, ai, audit  (+ api-tokens, webhooks, integrations [5])
│   │       │   │       └── p/[key]/
│   │       │   │           ├── page.tsx         ✓ dashboard
│   │       │   │           ├── requirements/    ✓
│   │       │   │           ├── test-cases/      ✓
│   │       │   │           ├── runs/            + [next] list, [ref]/execute (fast execution screen)
│   │       │   │           ├── bugs/            + [next] table, board (Kanban), [ref]
│   │       │   │           ├── automation/      + [3] api/, ui/, runs/, schedules/
│   │       │   │           ├── releases/        + [4]
│   │       │   │           ├── reports/         + [4]
│   │       │   │           └── settings/        ✓ general, environments, modules (+ custom fields, templates)
│   │       │   └── share/[token]/   + [4] read-only report links (no login)
│   │       ├── components/          ✓ ui/ (shadcn), shell/, ai/, qa/, requirements/, test-cases/, org/, projects/
│   │       │                        + runs/, bugs/ [next]; automation/ [3]; releases/, reports/ [4]
│   │       ├── hooks/               ✓ queries.ts, qa.ts, ai.ts  (+ runs.ts, bugs.ts …)
│   │       └── lib/                 ✓ api client, types, tree, view state, copilot formatting
│   ├── api/                         ✓ NestJS REST + OpenAPI (/docs)
│   │   ├── README.md                + [next]
│   │   └── src/
│   │       ├── auth/ audit/ organizations/ projects/ environments/ storage/      ✓
│   │       ├── requirements/ suites/ test-cases/ views/ dashboard/ ai/           ✓
│   │       ├── common/              ✓ (+ rate limiting, signed URLs [next])
│   │       ├── test-runs/ bugs/ comments/ custom-fields/ notifications/          + [next]
│   │       ├── automation/ (api-collections, tests, runs, schedules, ci-hooks)   + [3]
│   │       ├── releases/ reports/ share/                                          + [4]
│   │       └── platform/ (api-tokens, webhooks, integrations, mcp)               + [5]
│   └── worker/                      ✓ BullMQ workers
│       ├── README.md                + [next]
│       └── src/
│           ├── ai/                  ✓ requirement, writer, reviewer jobs (+ bug agent [next], automation/failure [3], report [4])
│           ├── files/               + [next] malware scan (ClamAV), thumbnails
│           ├── runner/              + [3] Playwright + API execution in Docker sandboxes
│           ├── reports/             + [4] PDF (Playwright-to-PDF), DOCX, XLSX
│           └── delivery/            + [5] webhooks (retries + idempotency), Jira/GitLab sync, Slack/Teams
├── packages/
│   ├── db/                          ✓ Prisma schema, migrations, seed, crypto, storage, sequences
│   ├── shared/                      ✓ Zod contracts, RBAC, queue names, refs, AI contracts
│   ├── ai/                          ✓ provider adapters, versioned prompts, agents, evals (+ bug, automation, failure, report agents)
│   ├── runner/                      + [3] Playwright/API engine, assertion + chaining library, importers
│   └── ui/                          ✓ placeholder (components extracted from apps/web when a second app needs them)
├── infra/
│   ├── docker/                      ✓ api, worker, web Dockerfiles (+ runner sandbox image [3])
│   ├── clamav/                      + [next] virus scanning service (compose profile)
│   └── backup/                      + [next] daily pg_dump to S3 with retention
├── docs/
│   ├── adr/                         + [next] ADRs (DECISIONS.md split into numbered records)
│   ├── architecture/                ✓ this proposal
│   ├── ROADMAP.md  DECISIONS.md     ✓
└── .github/workflows/ci.yml         ✓ build, typecheck, lint, unit/integration, eval harness, E2E
```

## 3. Data model

### Traceability chain

```text
Requirement ──< RequirementTestCase >── TestCase ──< TestRunResult >── TestRun ── Release
     │                                     │              │                         │
     └──────── ReleaseItem ────────────────┼──── TestCaseBug >── Bug ── ReleaseItem ┘
                                           │              (Bug.testRunResultId = where it was found)
                                           └──< AutomationTest / ApiRequest ──< AutomationResult >── AutomationRun
```

### What's new, by phase

| Phase | Models                                                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| next  | `TestRun`, `TestRunResult`, `Bug`, `TestCaseBug`, `Comment`, `Notification`, `CustomField`, `Template`, `ProjectMember` (pending decision), `Attachment` scan + annotations |
| 3     | `ApiCollection`, `ApiRequest`, `AutomationTest`, `AutomationRun`, `AutomationResult`, `AutomationSchedule`                                                                  |
| 4     | `Release`, `ReleaseItem`, `QualityGate`, `Approval`, `Report`, `ReportSchedule`                                                                                             |
| 5     | `ApiToken`, `Webhook`, `WebhookDelivery`, `Integration`, `ExternalLink`                                                                                                     |

All 30 entities from the brief's minimum data model are covered. Naming differences: `AiUsage` exists; `Environment`/`Integration`/`Attachment`/`AgentJob`/`AuditLog` exist or are added as named; the brief's `RequirementSource(file)` exists.

### Key design choices (please check)

1. **Run results snapshot the test case** (`snapshot`, `testCaseVersion`): editing a case later never rewrites past runs.
2. **Parameterised test data** executes as one result per data row (`dataRowIndex`).
3. **Step-level results** (`stepResults`): a failed step pre-fills "Report bug" with the case, step, environment and evidence (`Bug.testRunResultId`, `failedStepIndex`).
4. **Bug workflow** New → Triaged → In progress → Fixed → Ready for retest → Closed / Reopened, with `resolution` (duplicate, won't fix…) and `duplicateOfId`. Kanban order via fractional `rank`.
5. **Comments** are one table (`entityType`, `entityId`) for bugs now and requirements/test cases later, with @mentions → notifications.
6. **Custom fields**: definitions in `CustomField`; values in each item's `customFields` JSONB (filterable with GIN indexes), avoiding a slow EAV table.
7. **Release contents** use `ReleaseItem` with three nullable foreign keys plus a CHECK constraint, so the brief's `ReleaseItem` keeps referential integrity.
8. **Reports freeze numbers** in `data` (computed from the DB); the AI only writes `narrative`. Share links store only a token hash.
9. **Automation results mirror into a Test Run** (`AutomationRun.testRunId`, `TestRunResult.automationResultId`), so manual and automated results are reported together.
10. **Webhooks are idempotent**: inbound CI calls use `AutomationRun.idempotencyKey`; outbound deliveries carry a stable `eventId` with retry state.
11. **Secrets** (environment secrets, webhook secrets, integration credentials, org AI keys) are encrypted at rest; API tokens are stored as hashes only.
12. **IDs**: `RUN-0001`, `BUG-0001`, `REL-0001` via the existing per-project counters.
13. **Embeddings**: `embedding vector(1024)` columns are drafted (commented out) on Requirement, TestCase and Bug, pending the embeddings provider decision.

## 4. Performance (NFR: 10,000 test cases < 1 s)

Existing: server-side pagination, composite indexes, trigram search indexes. Next phase adds: a seeded 10,000-case perf fixture with a timed API/E2E check, a virtualised table body, keyset pagination for deep pages, and `EXPLAIN` checks on list queries.

## 5. NFR gaps in existing features (proposed for the next phase)

| Requirement                 | Today                                 | Planned                                                                                       |
| --------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Signed URLs for files       | Authenticated download endpoint       | Short-lived HMAC-signed URLs (local) / presigned URLs (S3)                                    |
| Rate limiting               | None                                  | Redis-backed limits per IP, user and token (stricter on auth and AI endpoints)                |
| Uploads scanned             | Type and size checks only             | ClamAV scan in the worker; files unusable until CLEAN                                         |
| Daily DB backups            | None                                  | `infra/backup`: nightly `pg_dump` to S3 with 30-day retention + restore guide                 |
| Disable AI per organization | Per-agent switches                    | Master "AI off" switch in Settings → AI                                                       |
| Never send secrets to AI    | Secrets are never part of agent input | Plus a redaction pass on all agent input (keys, tokens, passwords, environment secret values) |
| 10k list in < 1 s           | Paginated                             | Perf fixture + virtualised tables (§4)                                                        |
| README per app, ADRs        | Root README, DECISIONS.md             | `apps/*/README.md`, `docs/adr/`                                                               |
| axe check per feature       | Main pages                            | Extend to every new screen                                                                    |
