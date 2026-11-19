# Sandbox image for Playwright UI tests (RUNNER_SANDBOX=docker).
#   docker build -f infra/docker/runner.Dockerfile -t qaforge-runner:latest .
# The worker starts one throwaway container per run with --read-only, --cap-drop=ALL,
# no-new-privileges and CPU/memory/process limits (packages/runner/src/playwright/drivers.ts).
# Keep the version in step with @playwright/test in packages/runner/package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

RUN npm install --global @playwright/test@1.63.0 && npm cache clean --force
# Test files import '@playwright/test'; resolve it from the global install.
ENV NODE_PATH=/usr/lib/node_modules \
    CI=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

USER pwuser
WORKDIR /work
