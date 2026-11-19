# 0013 · AI writes and repairs tests only with a person's approval

**Context.** The Automation Agent drafts Playwright tests from manual test cases and repairs broken locators; the Failure Analysis Agent classifies failures. An agent that silently edits tests could hide real product bugs (for example by deleting the assertion that fails).

**Decision.**

- Generated tests are saved **disabled** and tagged `ai-draft`; someone reviews, runs and enables them.
- Repairs are stored as a **pending fix** next to the test and shown as a diff. Approving creates a new version (`ai_repair`); dismissing discards it. The agent's output is rejected if it has fewer assertions than the current code, and the fix records the version it was based on so a stale suggestion is flagged.
- Failure analysis is a suggestion with a confidence; the confidence is capped when the evidence isn't grounded in the log, and results that passed on retry are always classified as flaky. Automatic analysis runs only when AI is on, configured, the agent enabled and the budget allows, and at most 10 times per run.
- Agents see test code, steps, error text and the page snapshot, never environment secrets (ADR 0005).

**Consequences.** Fixes need one click from a person, so they are slower than auto-heal, but a run can't turn green because the AI changed what was tested. Every AI change is in the test's version history and the audit log.
