# QAForge delivery plan

Each phase ends with working, tested, committed code and a review checkpoint.

| # | Phase | Scope | Status |
|---|---|---|---|
| 1 | **Foundation** | Monorepo, Postgres/Prisma, Better Auth (email + Google/Microsoft SSO), orgs, projects, members, invitations, 7-role RBAC, audit history, app shell, command palette, light/dark, Swagger, Docker Compose, CI | ✅ Done |
| 2 | **Requirements & test cases** | Tiptap requirements, test case repository (suites, steps, priority, tags), human refs (`PAY-TC-12`), inline edit + bulk actions, Draft → In review → Approved workflow (Client can approve), req ↔ TC links, comments, attachments (MinIO), per-item history | Next |
| 3 | **AI layer** | `packages/ai` (Claude adapter by default; OpenAI/Gemini later), per-org model/key/limits, BullMQ AI jobs with live progress (SSE), generate test cases from a requirement as **drafts** (accept/edit/reject), pgvector embeddings for duplicate detection and semantic search, prompt evals | |
| 4 | **Test runs & bugs** | Test plans, manual execution (pass/fail/blocked/skip with evidence), live run progress, bug tracker linked to failed steps, AI bug-report drafts, duplicate-bug detection | |
| 5 | **Automation** | `packages/runner`: Playwright UI + API tests in isolated Docker workers, AI-drafted scripts from approved test cases, traces/videos/screenshots to S3, flaky-test detection | |
| 6 | **Releases & reports** | Release scope, quality gates, coverage/traceability matrix, sign-off (QA Lead + Client), exports to PDF, DOCX, CSV and Excel, dashboards | |
| 7 | **Platform & ops** | API tokens, webhooks, MCP server, notifications/email, OpenTelemetry traces, Sentry, performance budget (<1 s), deployment guides | |
