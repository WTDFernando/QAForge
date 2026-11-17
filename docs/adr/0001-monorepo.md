# 0001 · pnpm + Turborepo monorepo

**Context.** Web, API and worker share validation rules, permissions, queue payloads and AI agents. Copying them would drift.

**Decision.** One repository: `apps/{web,api,worker}` and `packages/{shared,db,ai,runner,ui}`, pnpm workspaces and Turborepo pipelines (build, typecheck, lint, test). `@qaforge/shared` holds Zod schemas, RBAC and queue contracts; `@qaforge/db` holds the Prisma client and server helpers.

**Consequences.** A contract change is one commit and fails typecheck everywhere it matters. Shared packages must be built before the apps (`pnpm build`). `packages/ui` stays a placeholder until a second front end needs the components.
