# QAForge

AI-first, all-in-one QA platform: requirement → approved test cases → executed runs → logged bugs → signed release report, in one app.

> Status: **Phase 1 (Foundation) complete.** See [docs/ROADMAP.md](docs/ROADMAP.md) for the phase plan and [docs/DECISIONS.md](docs/DECISIONS.md) for architecture decisions.

## Quick start

Prerequisites: Node 22+, pnpm 10, Docker.

```bash
cp .env.example .env            # then set BETTER_AUTH_SECRET to a random 32+ char string
docker compose up -d            # Postgres 16 + pgvector, Redis
pnpm install
pnpm build                      # builds shared packages + generates the Prisma client
pnpm db:deploy && pnpm db:seed  # schema + demo data
pnpm dev                        # web :3000, API :4000, worker
```

Open http://localhost:3000 and sign in with any demo account (password `qaforge-demo-1`):

| Email | Role |
| --- | --- |
| owner@qaforge.dev | Owner |
| lead@qaforge.dev | QA Lead |
| qa@qaforge.dev | QA Engineer |
| dev@qaforge.dev | Developer |
| client@qaforge.dev | Client (read-only + approve) |

API docs (Swagger): http://localhost:4000/docs · OpenAPI JSON: http://localhost:4000/openapi.json

Keyboard: `⌘K` / `Ctrl+K` command palette, `C` create project.

## Repository layout

```
apps/
  web/      Next.js 16 (App Router) + Tailwind 4 + shadcn/ui + TanStack Query/Table
  api/      NestJS 11 REST API, Better Auth, RBAC, audit log, Swagger
  worker/   BullMQ workers (AI agents, test runner, reports land here)
packages/
  db/       Prisma schema, migrations, seed
  shared/   Zod schemas, RBAC matrix, queue contracts, ID helpers (used by web + api + worker)
  ai/       (Phase 3) provider-agnostic model adapters, agents, prompts, evals
  runner/   (Phase 5) Playwright UI + API execution engine
  ui/       shared design system (components live in apps/web until a 2nd consumer exists)
infra/docker/  production Dockerfiles
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run everything in watch mode |
| `pnpm build` / `typecheck` / `lint` | Turborepo pipelines |
| `pnpm test` | Unit + API integration tests (Vitest, needs Postgres + Redis; uses DB `qaforge_test`) |
| `pnpm --filter @qaforge/web e2e` | Playwright E2E against a running, seeded stack |
| `pnpm db:migrate` | Create a new migration in development |
| `pnpm db:deploy` / `db:seed` | Apply migrations / load demo data |
| `pnpm --filter @qaforge/api openapi` | Write `openapi.json` |

## How requests flow

The browser only talks to the Next.js origin. `/api/auth/*` and `/v1/*` are rewritten to the NestJS API, which is the single source of truth (the web app never touches the database). Auth cookies stay first-party and no CORS is needed. Every API route requires a session unless marked `@Public()`. Org-scoped routes declare `@RequirePermission(...)`. The guard resolves the caller's membership from `:orgId` or `:projectId` and returns **404** to non-members, so the API never reveals that a resource exists.
