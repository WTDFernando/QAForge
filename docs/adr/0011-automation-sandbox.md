# 0011 · Automation runs in a sandbox, API tests can't reach private networks

**Context.** Phase 3 runs code that users write (Playwright tests) and requests that users configure (API tests) on our servers. That is remote code execution and server-side request forgery by design, so the blast radius has to be contained.

**Decision.**

- UI tests run in a **throwaway container per run** (`DockerDriver`): read-only root file system, all Linux capabilities dropped, `no-new-privileges`, non-root user, memory / CPU / PID limits, a hard run timeout, and only the run's workspace mounted. Environment values reach the container by name from the docker CLI's own environment, never on the command line.
- The worker never gives tests its own environment (database URL, keys). Tests get only the run environment's variables and decrypted secrets, and logs are redacted before they are stored.
- A `ProcessDriver` exists for development and CI without Docker. It is refused in production unless `RUNNER_ALLOW_PROCESS_IN_PRODUCTION=true`.
- API tests use an HTTP agent whose DNS lookup rejects private, loopback, link-local and cloud-metadata addresses (OWASP A10), which also covers redirects and DNS rebinding. Private addresses are allowed outside production, or with `AUTOMATION_ALLOW_PRIVATE_NETWORKS=true` for an isolated runner network.
- One syntax error must not hide the other results: files are syntax-checked first and reported on their own.

**Consequences.** Production needs a Docker daemon next to the worker (or a remote one) and the runner image. Testing an app on a private network needs a dedicated, isolated worker with the private-network flag. Container start adds a few seconds per run.
