# Checkpoint: Phase 4 — Releases & reports

Date: 2026-11-27 · Branch: `main`

## What was built

**Releases** (Payments → Releases)

- A release has a name, version (unique per project), target date and scope: requirements and bugs it contains, and the test runs that verify it. Bugs found in those runs are included automatically.
- **Quality gates**: pass rate, execution complete, open bugs by severity, requirement coverage, high-priority requirements passed, automation pass rate. Each is blocking or advisory. New releases start with sensible defaults.
- **Readiness score** (0–100, documented formula) with a band: Ready, At risk, Not ready, or Blocked when a blocking gate fails (ADR 0014).
- **Sign-off**: name approvers (QA Lead, Product Manager, Client…). Approval can be requested only when every blocking gate passes; the gates are frozen at that moment and each decision stores the numbers it was made on. Rejection needs a reason. Approvers are notified; when everyone approves, a lead marks the release as released. Everything is in the audit log.

**Reports** (Payments → Reports)

- Six reports built from the database: **Go / No-Go** (verdict, gates, readiness, open bugs, requirements, sign-off), **test execution** (by run, suite and tester, failures), **traceability matrix** (requirement → test case → latest result → bugs), **bug summary**, **sprint summary** and **automation trend**.
- **Report Agent**: an optional summary, highlights, risks and recommendation. Every number and item ref it writes must appear in the report; anything else is removed, and it can't overrule a No-go (ADR 0015).
- **Exports**: PDF, Word, Excel (one sheet per section) and CSV.
- **Read-only share links** for people without an account: expire after 1–90 days and can be turned off (ADR 0016).
- **Emailed reports** on a schedule (e.g. a weekly bug summary to the product owner) with the chosen attachments.

**Design**: “07 Release readiness” and “08 Report” in Figma (https://www.figma.com/design/1r4qeekenErekQjLcqfbHN); the Releases and Reports items were added to the sidebar component.

## How to try it

```bash
git pull
pnpm install && pnpm build
pnpm db:deploy && pnpm db:seed
pnpm dev
```

Sign in as `lead@qaforge.dev` / `qaforge-demo-1`:

1. **Releases → Spring release 2.4.0**: readiness, the gates it fails, scope and approvers. _Request approval_ is disabled until the blocking gates pass.
2. **Go / No-Go report**: the report builds in a few seconds, with an AI summary when AI is set up (`QAFORGE_AI_PROVIDER=fake` works offline). Download any format, or **Share link** and open it in a private window.
3. **Reports → New report** for a bug summary or a traceability matrix; **Emailed reports** shows the paused weekly bug summary. To see the emails, run `docker compose --profile mail up -d`, set `SMTP_URL=smtp://localhost:1025` in `.env`, and open http://localhost:8025.

## Screenshots

[`docs/screenshots/phase-4`](../screenshots/phase-4): releases list, release readiness, Go/No-Go report with the AI summary, the shared (signed-out) view, reports and schedules.

## Test results

| Suite                            | Result                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit + integration (Vitest)      | 275 passed: API 113, worker 39, AI 37, shared 35, runner 26, web 20, reports 5. All six report builders are checked against known numbers in a real database                               |
| E2E (Playwright), new            | 5 tests: blocked release can’t be sent for approval; plan → approve (as the client) → ship; Go/No-Go with AI summary, PDF download, share link on and off; period bug summary; role limits |
| Accessibility (axe, WCAG 2.2 AA) | No serious or critical violations on 18 pages (releases, release, reports added) in light and dark, plus the report page and the shared report                                             |
| Build / typecheck / lint         | Pass (2 older lint warnings)                                                                                                                                                               |

## Known limitations

- Email delivery was tested with a stand-in mailer; a real SMTP server (or Mailpit) hasn't been used in this environment.
- The Report Agent has only run against the offline fake provider; real-model evals need an Anthropic API key (`pnpm --filter @qaforge/ai eval`).
- Readiness weights are fixed (documented in ADR 0014); teams adjust by making more gates blocking.
- The Figma screenshot check for “08 Report” was cut short by the Starter plan’s MCP call limit (the screen itself was created).
- Charts in reports are horizontal bars; trend lines over time can come with the dashboards in Phase 5.

## Next

Phase 5: Integrations & polish (Jira/GitHub/Slack, public API tokens, webhooks, MCP server, custom fields, i18n, observability).
