# Checkpoint: Phase 1 — Core QA

Date: 2026-11-17 · Branch: `main` · CI: green

## What was built

**Test runs**

- Plan a run from a suite (with sub-suites) or by case status; environment, build, default assignee, due date. Results store a snapshot of each case (ADR 0008); parameterised cases get one result per data row.
- Execution screen: case list with All / Mine / Failed / Untested filters and search; per-step Pass/Fail/Blocked/Skip; actual result on failed steps; evidence by drop, click or paste; notes; per-case timer; shortcuts `P F B S`, `J K`, `N`. Results update instantly (optimistic) and auto-advance to the next untested case.
- "Report bug from this step" pre-fills steps, expected/actual and links the run, environment and build.
- Close and reopen runs; live pass rate and segmented progress.

**Bugs**

- Workflow New → Triaged → In progress → Fixed → Ready for retest → Closed (resolution required; duplicates link to the original), Reopened.
- Kanban board (drag and drop or `1`–`5` on a focused card) and table view; filters by severity, component, assignee; search.
- Detail page: workflow stepper, editable properties, annotated screenshots, linked test cases, comments with mentions (API), Bug Agent notes.
- **Quick report** with the Bug Agent: screenshot + one line → full draft with highlight box, duplicate check and missing information; nothing is filed until the tester clicks Create bug.

**Across the product**

- Notifications bell (assignments, mentions, status changes, ready for retest) linking straight to the item.
- Dashboard: last run pass rate, open bugs by severity, failed tests in active runs, bugs assigned to me.
- Project role overrides (Project settings → People and roles).
- AI master switch per organization; secrets and credentials are redacted from every prompt.
- Security: signed short-lived download links, Redis rate limiting, optional ClamAV scanning, nightly backups with restore script.
- Performance: 10,000 test cases list in about 300 ms (browser) with virtualised large pages.
- Designs in Figma: https://www.figma.com/design/1r4qeekenErekQjLcqfbHN

## How to run

See the root [README](../../README.md). In short: `docker compose up -d`, `pnpm install && pnpm build`, `pnpm db:deploy && pnpm db:seed`, `pnpm dev`, then sign in as `qa@qaforge.dev` / `qaforge-demo-1` and open **Payments → Test runs → RUN-0002**. Set `QAFORGE_AI_PROVIDER=fake` to try the Bug Agent without an API key.

## Screenshots

[`docs/screenshots/phase-1`](../screenshots/phase-1): runs, execution (failed step), bugs board, quick report (empty and draft), bug detail, dashboard.

## Test results

| Suite                            | Result                                                                                                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit + integration (Vitest)      | 185 passed: API 90, worker 24, AI 26, shared 27, web 18 · API line coverage 90.6%                                                                                                                  |
| E2E (Playwright)                 | 30 passed, incl. run execution by keyboard, report bug from step, plan a run, Kanban keyboard move, quick report with the Bug Agent, workflow + notifications, project roles, 10k list performance |
| Accessibility (axe, WCAG 2.2 AA) | No serious or critical violations on 10 pages, light and dark                                                                                                                                      |
| Performance                      | API 26–61 ms per list request on 10k cases; browser ~300 ms (budget 1 s)                                                                                                                           |
| Agent evals                      | Harness passes offline; real-model run pending an API key                                                                                                                                          |

## Known limitations

- The Bug Agent and other agents have only been run against the offline fake provider here; real Claude evals need an API key.
- The UI checks the organization role, not the project override; the API enforces overrides, so an overridden user may see a button the API refuses.
- Comments are plain text in the UI; mentions work in the API but there is no mention picker yet.
- ClamAV scanning is tested against a stand-in clamd; the real container and the backup scheduler have not been run in this environment.
- Duplicate detection is title similarity (trigram); embeddings wait for the provider decision.
- Failure Analysis Agent (Phase 2) not started.
- E2E needs the API started with `RATE_LIMIT_AUTH_PER_MIN=1000` (many sign-ins from one address).

## Next

Phase 2 remainder (Failure Analysis Agent, real-model evals) and Phase 3 Automation.
