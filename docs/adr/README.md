# Architecture decision records

Short records of decisions that are expensive to reverse. Format: context, decision, consequences. Superseded records stay, marked as such. Day-to-day conventions live in [../DECISIONS.md](../DECISIONS.md).

| #                                 | Decision                                                              | Status   |
| --------------------------------- | --------------------------------------------------------------------- | -------- |
| [0001](0001-monorepo.md)          | pnpm + Turborepo monorepo, shared contracts package                   | Accepted |
| [0002](0002-api-owns-data.md)     | NestJS API is the only data owner; Next.js proxies to it              | Accepted |
| [0003](0003-auth-and-rbac.md)     | Better Auth sessions, 7 roles, project overrides, 404 for non-members | Accepted |
| [0004](0004-postgres-prisma.md)   | Postgres 16 + Prisma; trigram search now, pgvector later              | Accepted |
| [0005](0005-ai-agents.md)         | Provider-agnostic agents, drafts only, redaction, per-org switch      | Accepted |
| [0006](0006-files.md)             | Object storage, signed URLs, optional malware scanning                | Accepted |
| [0007](0007-jobs-and-realtime.md) | BullMQ jobs, Redis pub/sub, SSE                                       | Accepted |
| [0008](0008-run-snapshots.md)     | Test run results store a snapshot of the case                         | Accepted |
| [0009](0009-list-performance.md)  | Offset pagination + virtualised table for 10k cases                   | Accepted |
| [0010](0010-design-in-figma.md)   | Design screens in Figma first, tokens mirrored in CSS                 | Accepted |
