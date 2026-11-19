# @qaforge/runner

The execution engine for Phase 3 (Automation). The worker (`apps/worker/src/automation`) uses it to run automation runs; the API uses it to send single requests from the editor and to import collections. It has no database access.

## What's inside

| Area         | Files                                 | What it does                                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API requests | `src/api/execute.ts`                  | Sends one request: `{{variables}}` (nested, `{{env.NAME}}`, `{{$guid}}` …), auth helpers (bearer, basic, API key, OAuth 2 client credentials with a token cache), assertions (status, header, JSON path, JSON schema, time, body), extract rules for chaining. |
|              | `src/api/variables.ts`                | Interpolation and secret redaction. Every exchange that is stored has secret values and credential headers replaced by `[redacted]`.                                                                                                                           |
|              | `src/api/net-guard.ts`                | SSRF guard: blocks private, loopback, link-local and cloud-metadata addresses at DNS lookup time (covers redirects and DNS rebinding). See ADR 0011.                                                                                                           |
| Import       | `src/importers/*`                     | Postman v2.1, OpenAPI 3 / Swagger 2 (JSON or YAML), Bruno `.bru`, cURL (incl. Chrome's "Copy as cURL" `$'…'` quoting) → a folder tree of requests.                                                                                                             |
| UI tests     | `src/playwright/workspace.ts`         | Writes a throwaway workspace per run: the test files and a generated `playwright.config.ts` (values JSON-encoded, never spliced in as code).                                                                                                                   |
|              | `src/playwright/drivers.ts`           | Sandboxes. `DockerDriver` (production): read-only root, all capabilities dropped, no-new-privileges, memory/CPU/PID limits, non-root user; env passed by name only. `ProcessDriver` (dev/CI): minimal environment, refused in production.                      |
|              | `src/playwright/run.ts`, `results.ts` | Pre-checks syntax per file (one broken file doesn't sink the run), runs Playwright, maps the JSON report back to each file: status, attempts, flaky (passed on retry), log, trace / video / screenshots.                                                       |
| Schedules    | `src/cron.ts`                         | `nextCronRun` and `validateCron` (5-field cron, with time zone).                                                                                                                                                                                               |

## Configuration (worker)

| Variable                                         | Default                                     | Meaning                                                             |
| ------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------- |
| `RUNNER_SANDBOX`                                 | `docker` in production, `process` otherwise | Which sandbox runs UI tests                                         |
| `RUNNER_IMAGE`                                   | `qaforge-runner:latest`                     | Image built from `infra/docker/runner.Dockerfile`                   |
| `RUNNER_NETWORK`, `RUNNER_MEMORY`, `RUNNER_CPUS` | `bridge`, `2g`, `2`                         | Container limits                                                    |
| `RUNNER_ALLOW_PROCESS_IN_PRODUCTION`             | `false`                                     | Escape hatch; don't use it on shared servers                        |
| `AUTOMATION_ALLOW_PRIVATE_NETWORKS`              | on outside production                       | Let API tests reach private addresses (e.g. a local app under test) |
| `AUTOMATION_CONCURRENCY`                         | `2`                                         | Runs in parallel per worker process                                 |

Build the runner image once: `docker build -f infra/docker/runner.Dockerfile -t qaforge-runner:latest .`

## Tests

`pnpm --filter @qaforge/runner test` runs the engine against a local HTTP server and real Chromium through the process sandbox (install it once with `pnpm --filter @qaforge/runner exec playwright install chromium`).
