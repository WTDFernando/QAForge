import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  browsersPath,
  configSource,
  createWorkspace,
  DockerDriver,
  ProcessDriver,
  runUiTests,
} from './index';

let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      `<!doctype html><title>Shop</title><h1>Checkout</h1><button id="pay">Pay $120</button>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

const TESTS = [
  {
    id: 'pass',
    path: 'checkout/pass.spec.ts',
    code: `import { test, expect } from '@playwright/test';
test('shows the pay button', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Pay $120' })).toBeVisible();
  console.log('secret seen:', process.env.SHOP_PASSWORD === 'hunter2', 'db leaked:', !!process.env.DATABASE_URL);
});`,
  },
  {
    id: 'fail',
    path: 'checkout/fail.spec.ts',
    code: `import { test, expect } from '@playwright/test';
test('has a discount field', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Discount code')).toBeVisible({ timeout: 500 });
});`,
  },
  {
    id: 'flaky',
    path: 'flaky.spec.ts',
    code: `import { test, expect } from '@playwright/test';
test('passes on retry', async ({ page }) => {
  expect(test.info().retry, 'first attempt fails on purpose').toBeGreaterThan(0);
});`,
  },
  {
    id: 'broken',
    path: 'broken.spec.ts',
    code: `import { test } from '@playwright/test';\ntest('x', async () => { const = ; });`,
  },
];

describe('Playwright runner (process sandbox)', () => {
  it('runs files and reports pass, fail with evidence, flaky and broken files', async () => {
    process.env.DATABASE_URL ??= 'postgres://should-not-leak';
    const res = await runUiTests(TESTS, {
      baseURL: base,
      env: { SHOP_PASSWORD: 'hunter2' },
      retries: 1,
      timeoutPerTestMs: 10_000,
      timeoutMs: 120_000,
      driver: new ProcessDriver(),
    });
    try {
      const by = Object.fromEntries(res.outcomes.map((o) => [o.id, o]));
      expect(res.driver).toBe('process');
      expect(by.pass).toMatchObject({ status: 'PASSED', flaky: false });
      expect(by.pass!.log).toContain('secret seen: true db leaked: false');
      expect(by.fail).toMatchObject({ status: 'FAILED', attempts: 2 });
      expect(by.fail!.error).toContain('getByLabel');
      const kinds = by.fail!.attachments.map((a) => a.contentType);
      expect(kinds).toEqual(expect.arrayContaining(['application/zip', 'image/png']));
      expect(by.fail!.attachments.every((a) => existsSync(a.path))).toBe(true);
      expect(by.flaky).toMatchObject({ status: 'PASSED', flaky: true, attempts: 2 });
      expect(by.broken!.status).toBe('FAILED');
      expect(by.broken!.error).toMatch(/^Syntax error at line 2, column 31: /);
      expect(res.error).toBeNull();
    } finally {
      await res.cleanup();
    }
  }, 120_000);

  it('stops a run that exceeds its time limit', async () => {
    const res = await runUiTests(
      [
        {
          id: 'slow',
          path: 'slow.spec.ts',
          code: `import { test } from '@playwright/test';\ntest('slow', async () => { await new Promise((r) => setTimeout(r, 60000)); });`,
        },
      ],
      { timeoutMs: 3000, timeoutPerTestMs: 120_000, retries: 0, driver: new ProcessDriver() },
    );
    await res.cleanup();
    expect(res.timedOut).toBe(true);
    expect(res.error).toMatch(/exceeded 3 s/);
    expect(res.outcomes[0]!.status).toBe('FAILED');
  }, 60_000);
});

describe('sandbox configuration', () => {
  it('builds a locked-down docker command without secret values on the command line', () => {
    const args = new DockerDriver({ image: 'qaforge-runner:1', network: 'qaforge-tests' }).args({
      dir: '/tmp/ws',
      env: { BASE_URL: 'https://shop.test', SHOP_PASSWORD: 'hunter2' },
      timeoutMs: 1000,
    });
    expect(args).toEqual(
      expect.arrayContaining([
        '--rm',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--network=qaforge-tests',
        '--user=pwuser',
        '--volume=/tmp/ws:/work',
        'qaforge-runner:1',
      ]),
    );
    expect(args.join(' ')).not.toContain('hunter2');
    expect(args.join(' ')).toContain('--env SHOP_PASSWORD');
  });

  it('finds browsers even when PLAYWRIGHT_BROWSERS_PATH is not set', () => {
    const prev = process.env.PLAYWRIGHT_BROWSERS_PATH;
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    try {
      expect(browsersPath()).toMatch(/ms-playwright$/);
      expect(browsersPath()).not.toContain('qaforge-run-');
    } finally {
      if (prev) process.env.PLAYWRIGHT_BROWSERS_PATH = prev;
    }
  });

  it('refuses the process sandbox in production unless allowed', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(
        new ProcessDriver().run({ dir: '/tmp', env: {}, timeoutMs: 1000 }),
      ).rejects.toThrow(/disabled in production/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('rejects unsafe paths and keeps config values as data', async () => {
    await expect(
      createWorkspace([{ id: 'x', path: '../evil.spec.ts', code: '' }], {
        retries: 0,
        timeoutMs: 1,
        workers: 1,
      }),
    ).rejects.toThrow(/Invalid test path/);
    const src = configSource({
      baseURL: "https://x.test'); process.exit(1); ('",
      retries: 1,
      timeoutMs: 5000,
      workers: 1,
    });
    expect(src).toContain(JSON.stringify("https://x.test'); process.exit(1); ('"));
  });
});
