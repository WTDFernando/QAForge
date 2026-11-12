# QAForge – notes for AI assistants

- Read `docs/ROADMAP.md` (phases) and `docs/DECISIONS.md` (choices + conventions) first.
- Do not change a stack decision without asking the product owner.
- `apps/web` uses Next.js 16: read `apps/web/AGENTS.md` and the bundled docs in `node_modules/next/dist/docs` before writing Next code.
- Shared contracts (Zod schemas, RBAC, queue names) live in `packages/shared`. Change them there, then `pnpm build`.
- Every mutation must call `AuditService.record` inside the same Prisma transaction.
- Tests: `pnpm test` (needs Postgres + Redis locally). E2E: `pnpm --filter @qaforge/web e2e` against a running, seeded stack.
