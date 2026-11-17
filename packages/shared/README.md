# @qaforge/shared

Contracts used by the web app, the API and the worker. Change them here, then `pnpm build`.

- **Zod schemas** for every request body and query (`qa.ts`, `runs.ts`, `bugs.ts`, `ai.ts`). Update schemas use `patchOf()` so defaults aren't re-applied on PATCH.
- **RBAC** (`roles.ts`): 7 roles, the permission matrix, `hasPermission`, `canAssignRole`.
- **Workflows**: `BUG_TRANSITIONS`/`canMoveBug`, `RUN_TRANSITIONS`, test case review transitions.
- **IDs**: `formatRef`/`parseRef` (REQ-0001, TC-0001, RUN-0001, BUG-0001).
- **Queues** (`queues.ts`): queue names and job payloads.
- Helpers: `passRate`, `richTextToPlain`, `humanize`.
