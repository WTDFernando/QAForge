# 0002 · The API owns all data

**Context.** Next.js can query databases directly, but then rules (permissions, audit, transactions) would live in two places.

**Decision.** Only NestJS reads and writes Postgres. The browser talks to the Next.js origin, which rewrites `/v1/*` and `/api/auth/*` to the API. Every mutation records an audit entry with `AuditService.record` inside the same transaction.

**Consequences.** One place enforces permissions and auditing; the public REST API is the same API the UI uses (OpenAPI generated from Zod). Cookies stay first-party, no CORS in the browser. The web app does no server-side data fetching for now; pages render client-side with TanStack Query.
