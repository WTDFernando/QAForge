# QAForge

AI-first, all-in-one QA platform: requirement → approved test cases → executed runs → logged bugs → signed release report, in one app.

> Status: **Phase 1 (Core QA) complete:** requirements, test cases, test runs, bugs, dashboard, Bug Agent. See [docs/ROADMAP.md](docs/ROADMAP.md) for the phase plan, [the Phase 1 checkpoint](docs/checkpoints/phase-1-core-qa.md), and [docs/DECISIONS.md](docs/DECISIONS.md) for architecture decisions.

## Quick start

Prerequisites: Node 22+, pnpm 10, Docker.

```bash
cp .env.example .env            # then set BETTER_AUTH_SECRET to a random 32+ char string
docker compose up -d            # Postgres 16 + pgvector, Redis
pnpm install
pnpm build                      # builds shared packages + generates the Prisma client
pnpm db:deploy && pnpm db:seed  # schema + demo data (runs, bugs, notifications included)
pnpm --filter @qaforge/runner exec playwright install chromium  # browser for UI test runs
pnpm dev                        # web :3000, API :4000, worker
```

In development UI tests run in a local process sandbox. In production they run in a container per run: build the image with `docker build -f infra/docker/runner.Dockerfile -t qaforge-runner:latest .` (see [packages/runner](packages/runner/README.md)).

Open http://localhost:3000 and sign in with any demo account (password `qaforge-demo-1`):

| Email              | Role                         |
| ------------------ | ---------------------------- |
| owner@qaforge.dev  | Owner                        |
| lead@qaforge.dev   | QA Lead                      |
| qa@qaforge.dev     | QA Engineer                  |
| dev@qaforge.dev    | Developer                    |
| client@qaforge.dev | Client (read-only + approve) |

API docs (Swagger): http://localhost:4000/docs · OpenAPI JSON: http://localhost:4000/openapi.json

Keyboard: `⌘K` / `Ctrl+K` command palette (also accepts IDs like `TC-0003`), `C` create (requirement, test case or project, depending on the page), `/` search the list, `⌘S` / `Ctrl+S` save test case edits.

Uploaded files are stored in `.data/uploads` in development (`STORAGE_DRIVER=local`). Set `STORAGE_DRIVER=s3` and the `S3_*` variables to use any S3-compatible service.

## AI agents

Agents use Anthropic Claude (Claude Opus 5.5 by default). To turn them on, either:

- sign in as an Owner/Admin, open **Settings → AI**, and paste an Anthropic API key (stored encrypted), or
- set `ANTHROPIC_API_KEY` in `.env` for the whole server.

`pnpm dev` starts the worker that runs agent jobs. To try everything without a key, set `QAFORGE_AI_PROVIDER=fake` in `.env`: agents return deterministic demo drafts and the UI shows "Offline demo mode".

What you can do: **Quick report** a bug from a screenshot and one line (Bug Agent drafts it, you review and create it), **Analyze** an uploaded document (draft requirements + questions for the client), **Assess clarity** of a requirement, **Generate test cases** for a story, a feature, or all uncovered stories, **Review with AI** on a test case, and ask **QA Copilot** (⌘J / Ctrl+J) about the project. Everything AI produces is a draft in the review queue.

Agent evals (real model, costs roughly $0.50-$2 per run): `pnpm --filter @qaforge/ai build && pnpm --filter @qaforge/ai eval`.

## Testing a release (the core loop)

1. **Test runs → New run**: pick a suite (or filter by status), environment, build, assignee, due date.
2. Open the run and execute: `P` pass, `F` fail, `B` blocked, `S` skip, `J`/`K` move, `N` next untested. Mark individual steps, paste screenshots (`Ctrl+V`) and add notes.
3. On a failed step, **Report bug from this step**: steps, expected/actual, run, environment and build are filled in.
4. **Bugs**: drag cards across the board (or focus a card and press `1`–`5`), open a bug to move it through New → Triaged → In progress → Fixed → Ready for retest → Closed. The bell shows assignments, mentions and status changes.

Designs live in Figma: https://www.figma.com/design/1r4qeekenErekQjLcqfbHN (see [DECISIONS.md](docs/DECISIONS.md#design-source-figma)).

## Optional services

| Profile   | Command                                                            | Use                                                                                 |
| --------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `scan`    | `docker compose --profile scan up -d` then `CLAMAV_HOST=localhost` | Malware scanning of uploads (files are blocked until clean)                         |
| `backup`  | `docker compose --profile backup up -d`                            | Nightly `pg_dump` with 14-day retention, see [infra/backup](infra/backup/README.md) |
| `storage` | `docker compose --profile storage up -d`                           | MinIO, if you want to try the S3 driver locally                                     |

## Repository layout

```
apps/
  web/      Next.js 16 (App Router) + Tailwind 4 + shadcn/ui + TanStack Query/Table
  api/      NestJS 11 REST API, Better Auth, RBAC, audit log, Swagger
  worker/   BullMQ workers (AI agents, test runner, reports land here)
packages/
  db/       Prisma schema, migrations, seed
  shared/   Zod schemas, RBAC matrix, queue contracts, ID helpers (used by web + api + worker)
  ai/       agent framework: provider adapters (Claude), versioned prompts, agents, evals
  runner/   (Phase 3) Playwright UI + API execution engine
  ui/       shared design system (components live in apps/web until a 2nd consumer exists)
infra/docker/  production Dockerfiles
infra/backup/  backup + restore scripts
docs/          roadmap, decisions, ADRs (docs/adr), architecture, screenshots
```

## Scripts

| Command                              | What it does                                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                           | Run everything in watch mode                                                                                                                              |
| `pnpm build` / `typecheck` / `lint`  | Turborepo pipelines                                                                                                                                       |
| `pnpm test`                          | Unit + API integration tests (Vitest, needs Postgres + Redis; uses DB `qaforge_test`)                                                                     |
| `pnpm --filter @qaforge/web e2e`     | Playwright E2E (incl. WCAG 2.2 AA scan) against a running, seeded stack (start the API with `RATE_LIMIT_AUTH_PER_MIN=1000`: the tests sign in many times) |
| `pnpm db:migrate`                    | Create a new migration in development                                                                                                                     |
| `pnpm db:deploy` / `db:seed`         | Apply migrations / load demo data                                                                                                                         |
| `pnpm db:perf-fixture`               | Add a `PERF` project with 10,000 test cases (performance checks)                                                                                          |
| `pnpm --filter @qaforge/api openapi` | Write `openapi.json`                                                                                                                                      |

## How requests flow

The browser only talks to the Next.js origin. `/api/auth/*` and `/v1/*` are rewritten to the NestJS API, which is the single source of truth (the web app never touches the database). Auth cookies stay first-party and no CORS is needed. Every API route requires a session unless marked `@Public()`. Org-scoped routes declare `@RequirePermission(...)`. The guard resolves the caller's membership from `:orgId` or `:projectId` and returns **404** to non-members, so the API never reveals that a resource exists.
