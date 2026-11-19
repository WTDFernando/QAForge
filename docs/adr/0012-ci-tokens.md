# 0012 · CI pipelines use project tokens and idempotent triggers

**Context.** Pipelines must start automation runs after a deploy and wait for the result, without a user session, and CI systems retry steps.

**Decision.**

- QA Leads and Admins create **project tokens** (`qaf_ci_…`). The token is shown once; only a SHA-256 hash and a short prefix are stored. Tokens can only start and read automation runs in their project, expire (365 days by default) and can be revoked. Use is recorded (`lastUsedAt`) and every trigger is audited.
- `POST /v1/hooks/automation` takes an `Idempotency-Key` header: the same key returns the existing run instead of starting another (unique per project, with a race-safe fallback). `GET /v1/hooks/automation/runs/:ref` returns `{ status, done, totals, url }` for polling; the pipeline passes only when `status` is `PASSED`.
- The Schedules & CI page generates a GitHub Actions and a plain curl snippet with the right URL.

**Consequences.** No OAuth app is needed for CI. A leaked token can start runs in one project until it is revoked. Webhook push (instead of polling) can come with the Phase 5 integrations.
