# @qaforge/worker

BullMQ workers. Runs agent jobs and malware scans; the test runner (Phase 3) and report generation (Phase 4) will run here too.

```bash
pnpm --filter @qaforge/worker dev
```

| Queue       | Processor                             | Notes                                                                                                                                                                                                                        |
| ----------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-jobs`   | `src/ai/processor.ts` → `handlers.ts` | Checks the org's AI master switch, disabled agents and monthly budget. Redacts secrets from every prompt. Records cost per call and publishes progress over Redis for the SSE stream. Retries transient errors with backoff. |
| `file-scan` | `src/scan.ts`                         | Only when `CLAMAV_HOST` is set. Clean → usable; infected → deleted from storage, blocked and audited (`actorType: SYSTEM`).                                                                                                  |
| `system`    | `src/processors.ts`                   | Health ping                                                                                                                                                                                                                  |

AI-made changes are audited with `actorType: AI_AGENT` and `{ jobId, requestedBy, agent, model }` metadata. The Bug Agent only drafts: nothing is created until a person submits the bug.

Set `QAFORGE_AI_PROVIDER=fake` to run every agent offline with deterministic output (used by E2E).
