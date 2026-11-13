# Architecture decisions

Where the brief offered alternatives, these were chosen. Ask to revisit any of them.

| Topic | Choice | Why |
|---|---|---|
| Auth library | **Better Auth** | First-class Prisma adapter, email/password + Google + Microsoft built in, sessions stored in our DB. Org/RBAC is our own model (not the plugin) so permissions stay in `@qaforge/shared`. |
| Realtime | **Server-Sent Events** (from Phase 3) | Progress and agent status are server → client only. SSE works through proxies and needs no extra infra. |
| PDF export | **Playwright-to-PDF** (Phase 6) | Reuses the same Playwright we ship for test execution and renders the report's HTML exactly. |
| CI | **GitHub Actions** | `.github/workflows/ci.yml`: build, typecheck, lint, unit/integration tests, E2E. |
| Validation | **Zod 4** everywhere (`nestjs-zod` in the API) | One schema serves frontend forms, API DTOs and OpenAPI. |

## Versions pinned (and why)

- **Next.js 16.4 / React 19.3** with Cache Components + Partial Prefetching (the template defaults). The app shell renders a static skeleton instantly and streams the URL-aware UI.
- **NestJS 11** (not 12): 12 shipped after the stack was verified; we will upgrade once its ecosystem (swagger, pino, zod) catches up.
- **Prisma 6.19** (not 7): Prisma 7 requires driver adapters and a new client generator. 6.x is the mature line, and upgrading later is mechanical.
- **shadcn/ui**: the registry host was not reachable from the build environment, so the components in `apps/web/src/components/ui` were written by hand in the standard shadcn style (Radix + cva + tailwind-merge). They are ordinary source files, the same thing the CLI produces.

## Conventions

- Every tenant-owned row has a uuid `id`, `createdAt`/`updatedAt` and an org or project scope. Domain entities from Phase 2 also carry `projectId` and `createdById`.
- Every mutation writes an `audit_log` row in the **same transaction**, with a field-level diff (`{field: {from, to}}`). No-op updates are skipped. The actor is a user, an API token, an AI agent or the system.
- Non-members get **404**, never 403, on org and project resources.
- Long-running work (AI, runs, reports) goes through BullMQ queues defined in `@qaforge/shared/queues`.

## Phase 2 decisions

| Topic | Decision | Why |
|---|---|---|
| Local file storage | **Local disk in development, any S3-compatible service in production** (`STORAGE_DRIVER=local\|s3`) | The official MinIO image was removed from Docker Hub. One `StorageService` interface keeps the code identical. Approved by the product owner. |
| Item IDs | `TC-0142`, `REQ-0007` (per-project sequence, zero-padded) | Matches the brief. Project context is implied; cross-project views prefix the project key. |
| Data model growth | Models are added with the module that uses them (Phase 2 added Environment, Attachment, RequirementSource, Requirement(+Version), TestSuite, TestCase(+Version), TestStep, SharedStep, RequirementTestCase, SavedView) | Avoids designing 30 tables before their workflows exist. The remaining entities in the brief are scheduled in the roadmap. |
| Review workflow | Draft → In review → Approved → Deprecated. Approving (or sending back from review) needs `testcase:approve`, so **Clients can approve without edit rights**. Editing an approved case's content sends it back to In review. | "AI drafts, humans approve" plus a clear audit trail. |
| Versions | Every content or metadata change creates a version snapshot with an optional change note; no-op saves don't. | Version history per the brief. |
| Deletes | Soft delete (`deletedAt`) for requirements and test cases, so every delete toast offers **Undo**. | "Toasts with undo." |
| Secrets | Environment secrets are AES-256-GCM encrypted (`ENCRYPTION_KEY`, or derived from `BETTER_AUTH_SECRET`), write-only over the API, never written to the audit log. | Runner will need them, humans never need to read them back. |
| PATCH semantics | `patchOf()` builds update schemas without defaults. | Zod 4's `.partial()` keeps defaults, which made PATCH silently reset fields (caught by tests). |
| Onboarding | A "Get started" checklist on the project dashboard (create project → requirements → test cases → first run) rather than a modal wizard. | Teaches in context, never blocks; becomes a full wizard step once AI generation (Phase 3) and runs (Phase 4) exist. |
| Accessibility | axe-core WCAG 2.2 AA scan of the main pages in light and dark theme runs in the E2E suite. | Keeps the AA commitment testable. |

## Phase 3 decisions (AI)

| Topic | Decision | Why |
|---|---|---|
| Default model | **Claude Opus 5.5** (`claude-opus-5-5`); Sonnet 5.5 and Haiku 5.5 selectable per organization | Best quality for test design; orgs can trade quality for cost. |
| Request shape | Streaming structured outputs (Zod schema → `output_config.format`), adaptive thinking with explicit `effort` per agent (Requirement/Writer `high`, Reviewer/Copilot `medium`), system prompt cached | Valid JSON by construction, no timeouts on long outputs, lower cost on repeated calls. |
| Refusals | Server-side fallback on (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) for models that support it; a remaining refusal fails the job with a clear message | A policy decline on one model doesn't block the user. |
| "Never invent data" | Enforced in code after every call: only refs from the input, verbatim source quotes checked against the document, every step needs an expected result, reviewer issues must point at real steps. Violations are dropped and listed on the job. | Prompts ask; code guarantees. |
| Drafts only | Everything AI makes is DRAFT (`aiGenerated`, `aiJobId`, confidence, rationale). Reviewer suggestions and suggested criteria are never applied automatically. Audit entries use actor `AI_AGENT` with the requesting user and job in metadata. | "AI drafts, humans approve." |
| Where agents run | Requirement, Writer, Reviewer in the **worker** (BullMQ, progress over Redis → SSE). **Copilot in the API** process | Chat needs low latency and streams to one user; batch agents need retries and isolation. |
| Duplicate detection | **Postgres trigram similarity** (`pg_trgm`) on titles today. `pgvector` stays available for embeddings. | Anthropic has no embeddings API; this works with zero extra setup. See the open question below. |
| Keys & budgets | Per-org key AES-256-GCM encrypted, write-only, never logged; server `ANTHROPIC_API_KEY` as fallback. Monthly USD budget checked before every job and chat. Every call logged in `ai_usage` with tokens and estimated cost. | Brief: respect budgets, log tokens and cost, admins can disable agents. |
| Offline mode | `QAFORGE_AI_PROVIDER=fake`: deterministic drafts built from the input, labelled "Offline demo mode" and recorded as model `fake-model`, cost $0 | CI E2E and keyless demos exercise the full pipeline. |
| Evals | `packages/ai/src/evals`: fixed cases with programmatic checks (coverage of criteria, verified quotes, prompt-injection resistance, vague-input handling). `pnpm --filter @qaforge/ai eval` runs them on a real model; `--fake` checks the harness in CI. | Prompt changes are measurable before they ship. |

## Deferred (needs a product decision later)

- **Embeddings provider for semantic duplicate detection and search**: options are Voyage AI (Anthropic's recommended partner; new API key), an OpenAI embeddings key, or a local model in the worker (no external calls, more CPU). Trigram similarity covers near-identical titles until then.

- **Project-level roles** ("members and roles per project"): today the organization role applies to every project. Proposal for Phase 7: optional per-project role override.
- **i18n**: strings are English in components. Proposal: introduce `next-intl` in Phase 7 and extract strings then.
- **Saved views / grouping for requirements**: requirements use a tree with search; the full list framework is on test cases. Will be reused for bugs and runs.
