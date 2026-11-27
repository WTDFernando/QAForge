# @qaforge/reports

Phase 4: builds reports from the database and renders them. Used by the worker (`apps/worker/src/reports`).

| File              | What it does                                                                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/builders.ts` | One builder per report type: test execution, Go/No-Go, traceability matrix, bug summary, sprint summary, automation trend. Each returns a `ReportDoc` (key numbers, tables, bar charts, optional verdict) from `@qaforge/shared`. Tables are ordered deterministically. |
| `src/render.ts`   | Renders a `ReportDoc` (and the optional AI narrative) to self-contained HTML, PDF (headless Chromium via `playwright-core`, all network requests blocked), DOCX (`docx`), XLSX (`exceljs`, one sheet per section) and CSV (formula injection neutralised).              |

The numbers are never computed by the AI (see [ADR 0015](../../docs/adr/0015-report-numbers.md)). Release metrics used by the Go/No-Go report come from `computeReleaseMetrics` in `@qaforge/db`, the same function the release page uses.

PDF rendering needs Chromium: `pnpm --filter @qaforge/runner exec playwright install chromium` (the runner and reports share the browser).

Tests: `pnpm --filter @qaforge/reports test` (renderers); builders are tested against a real database in `apps/worker/src/reports/processor.test.ts`.
