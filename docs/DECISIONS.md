# Architecture decisions (Phase 1)

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
