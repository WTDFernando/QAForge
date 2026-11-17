# 0004 · Postgres 16 + Prisma; trigram now, embeddings later

**Context.** Relational QA data with strong integrity needs, plus "find similar" for duplicate test cases and bugs.

**Decision.** Postgres 16 with Prisma. Duplicate detection uses `pg_trgm` similarity on titles (GIN indexes declared in the schema). The `pgvector` extension is installed, but embeddings are postponed until the embedding provider is chosen. Per-project human IDs come from a counter table (`nextSeq`).

**Consequences.** Similarity catches near-identical wording but not paraphrases. Moving to embeddings is additive (a vector column plus a backfill job). Migrations are generated with `prisma migrate diff` (see `packages/db/README.md`).
