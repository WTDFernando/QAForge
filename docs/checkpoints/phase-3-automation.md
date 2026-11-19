# Checkpoint: Phase 3 — Automation

Date: 2026-11-19 · Branch: `main` · CI: green

## What was built

**API testing** (Automation → API client)

- Collections and folders with variables and auth that requests inherit. Requests with params, headers, body (JSON, text, form, GraphQL), auth helpers (bearer, basic, API key, OAuth 2 client credentials), assertions (status, header, JSON path, JSON schema, response time, body text) and extract rules.
- Send from the editor (`Ctrl+Enter`, save with `Ctrl+S`): response body / headers / request, assertion results next to the body, and extracted values chained into the next send.
- Import from Postman, OpenAPI / Swagger (JSON or YAML), Bruno and cURL (format detected from the file).
- Secrets are written as `{{env.NAME}}` and resolved at run time from environment secrets; stored exchanges are redacted. API tests can't reach private or cloud-metadata addresses in production (ADR 0011).

**UI tests** (Automation → UI tests)

- Playwright tests edited in Monaco (served by the app, no CDN), with Playwright type hints, versions and a history diff, enable / quarantine / disable, and a 409 conflict prompt when someone else saved first.
- **Automation Agent**: “Generate from test case” drafts a page-object test, saved disabled as `ai-draft`. “Suggest a fix” on a failed result proposes a locator repair as a diff; nothing changes until someone approves it (ADR 0013).

**Runs**

- Start on demand (everything, chosen tests or collections, or by tag; environment, build, retries), on a cron schedule, or from CI with a project token and an idempotency key (ADR 0012). The CI page generates a GitHub Actions and a curl snippet.
- UI tests run in a locked-down container per run (process sandbox in dev/CI). Each result keeps attempts, log, trace, video and screenshots; passing on retry marks it **flaky**, and a rolling flaky score is kept per test. Quarantined tests run but can't fail the run.
- Run detail: results with failure class, **Failure Analysis Agent** verdict (product bug / test problem / flaky / environment, with evidence and next step), evidence, API exchange, log, and **Report bug** pre-filled from the result. Results for linked test cases are written into a test run, and a failed run notifies the team.

**Design**: the API client screen is in Figma as “06 API client”. Screens 07–09 (test editor, run detail, schedules & CI) couldn't be drawn there because the Figma Starter plan's MCP call limit was reached; they were built in code in the same visual language (see screenshots).

## How to try it

```bash
pnpm install && pnpm build
pnpm db:deploy && pnpm db:seed
pnpm dev
```

Install Chromium for the runner once with `pnpm --filter @qaforge/runner exec playwright install chromium`, then sign in as `qa@qaforge.dev` / `qaforge-demo-1` and open **Payments → Automation**:

1. **API client** → _Health check_ → **Send**: 4/4 assertions pass against your local API.
2. **UI tests** → choose environment **Local** → _auth/sign-in.spec.ts_ → **Run**: it opens the run and passes against your local web app.
3. _checkout/new-card.spec.ts_ shows the AI's suggested fix; **Runs → AUT-0001** shows the failure analysis and **Report bug**.

## Screenshots

[`docs/screenshots/phase-3`](../screenshots/phase-3): API client after a send, UI test with the AI fix, runs list, run detail with failure analysis, schedules & CI.

## Test results

| Suite                            | Result                                                                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit + integration (Vitest)      | 234 passed: API 99, worker 31, runner 26, AI 31, shared 27, web 20. Runner tests drive real Chromium through the process sandbox                                                  |
| E2E (Playwright), new            | 7 automation tests: send + assertions + chaining, cURL import, approve AI fix, run a UI test in the sandbox, pre-filled bug from a failed result, CI token + webhook, role limits |
| Accessibility (axe, WCAG 2.2 AA) | No serious or critical violations on 15 pages (5 new automation pages), light and dark                                                                                            |
| Build / typecheck / lint         | Pass (2 older lint warnings)                                                                                                                                                      |

CI on a fresh seed: 37 of 37 E2E tests pass (all 7 new automation tests included), plus build, typecheck, lint and unit tests.

## Known limitations

- **The Docker sandbox wasn't executed here** (no Docker daemon in this environment). The command it builds is unit-tested, and the same runs pass through the process sandbox. Please try it on your PC: build the image (`docker build -f infra/docker/runner.Dockerfile -t qaforge-runner:latest .`) and start the worker with `RUNNER_SANDBOX=docker`.
- Agents were exercised with the offline fake provider; real-model evals need an Anthropic API key.
- Traces download as `trace.zip` (open with `npx playwright show-trace`); there is no embedded trace viewer yet.
- The “approve AI fix” E2E consumes the seeded suggestion, so it passes once per fresh seed.
- Figma screens 07–09 are missing until the Figma plan allows more MCP calls.

## Next

Phase 4: Releases & reports.
