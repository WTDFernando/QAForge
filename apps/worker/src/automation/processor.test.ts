import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptJson, getPrisma, insertAutomationRun, type Prisma } from '@qaforge/db';
import { ProcessDriver } from '@qaforge/runner';
import { executeAutomationRun, scheduleTick } from './processor';

const prisma = getPrisma();
let server: Server;
let target = '';
let orgId: string;
let projectId: string;
let userId: string;
let envId: string;
let caseA: string;
let caseB: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/api/login') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ token: 'tok-1' }));
    }
    if (req.url === '/api/me') {
      res.writeHead(req.headers.authorization === 'Bearer tok-1' ? 200 : 401, {
        'content-type': 'application/json',
      });
      return res.end(JSON.stringify({ name: 'Lee', key: req.headers['x-key'] ?? null }));
    }
    if (req.url === '/api/broken') {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'boom' }));
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Shop</title><h1>Checkout</h1><button>Pay</button>');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  target = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  userId = (
    await prisma.user.create({ data: { name: 'Auto', email: `auto${Date.now()}@test.dev` } })
  ).id;
  orgId = (await prisma.organization.create({ data: { name: 'A', slug: `a-${Date.now()}` } })).id;
  projectId = (
    await prisma.project.create({
      data: { organizationId: orgId, name: 'Shop', key: 'SHP', createdById: userId },
    })
  ).id;
  envId = (
    await prisma.environment.create({
      data: {
        projectId,
        name: 'Local',
        baseUrl: target,
        variables: { LANG: 'en' },
        secrets: encryptJson({ SHOP_KEY: 'shop-secret-999' }),
        createdById: userId,
      },
    })
  ).id;
  const tc = (seq: number, title: string) =>
    prisma.testCase.create({
      data: {
        projectId,
        seq,
        title,
        createdById: userId,
        updatedById: userId,
        steps: { create: [{ position: 0, action: 'Do', expected: 'Done' }] },
      },
    });
  caseA = (await tc(1, 'Checkout page shows Pay')).id;
  caseB = (await tc(2, 'Profile API returns the user')).id;

  const col = await prisma.apiCollection.create({
    data: {
      projectId,
      name: 'Profile',
      variables: { api: '{{baseUrl}}/api' },
      auth: { type: 'none' },
      createdById: userId,
    },
  });
  const req = (position: number, data: Partial<Prisma.ApiRequestUncheckedCreateInput>) =>
    prisma.apiRequest.create({
      data: {
        collectionId: col.id,
        name: 'r',
        url: '',
        position,
        createdById: userId,
        updatedById: userId,
        ...data,
      } as Prisma.ApiRequestUncheckedCreateInput,
    });
  await req(0, {
    name: 'Login',
    method: 'POST',
    url: '{{api}}/login',
    extract: [{ variable: 'token', from: 'jsonPath', path: '$.token' }],
  });
  await req(1, {
    name: 'Me',
    url: '{{api}}/me',
    auth: { type: 'bearer', token: '{{token}}' },
    headers: [{ name: 'X-Key', value: '{{env.SHOP_KEY}}', enabled: true }],
    assertions: [
      { type: 'status', op: 'eq', value: '200' },
      { type: 'jsonPath', path: '$.name', op: 'eq', value: 'Lee' },
    ],
    testCaseId: caseB,
  });
  await req(2, {
    name: 'Broken',
    url: '{{api}}/broken',
    assertions: [{ type: 'status', op: 'eq', value: '200' }],
  });

  const test = (
    path: string,
    code: string,
    extra: Partial<Prisma.AutomationTestUncheckedCreateInput> = {},
  ) =>
    prisma.automationTest.create({
      data: {
        projectId,
        name: path,
        path,
        code,
        createdById: userId,
        updatedById: userId,
        ...extra,
      } as Prisma.AutomationTestUncheckedCreateInput,
    });
  await test(
    'checkout.spec.ts',
    `import { test, expect } from '@playwright/test';\ntest('pay', async ({ page }) => { await page.goto('/'); await expect(page.getByRole('button', { name: 'Pay' })).toBeVisible(); });`,
    { testCaseId: caseA },
  );
  await test(
    'fails.spec.ts',
    `import { test, expect } from '@playwright/test';\ntest('discount', async ({ page }) => { await page.goto('/'); await expect(page.getByText('Discount')).toBeVisible({ timeout: 300 }); console.log('key', process.env.SHOP_KEY); });`,
  );
  await test(
    'quarantined.spec.ts',
    `import { test, expect } from '@playwright/test';\ntest('q', async () => { expect(1).toBe(2); });`,
    { status: 'QUARANTINED' },
  );
  await test(
    'disabled.spec.ts',
    `import { test } from '@playwright/test';\ntest('d', async () => {});`,
    { status: 'DISABLED' },
  );
});
afterAll(async () => {
  server.close();
  await prisma.$disconnect();
});

describe('automation runs', () => {
  it('runs API requests (chained) and UI tests, stores evidence and mirrors linked cases into a test run', async () => {
    const run = await prisma.$transaction((tx) =>
      insertAutomationRun(tx, {
        projectId,
        trigger: 'MANUAL',
        selection: { kind: 'all' },
        environmentId: envId,
        build: 'b1',
        retries: 0,
        createdById: userId,
      }),
    );
    let finished: string | undefined;
    const out = await executeAutomationRun(run.id, {
      driver: new ProcessDriver(),
      allowPrivate: true,
      onFinished: (r) => void (finished = r.status),
    });
    expect(out).toMatchObject({
      status: 'FAILED',
      totals: { total: 6, passed: 3, failed: 3, quarantined: 1 },
    });
    expect(finished).toBe('FAILED');

    const results = await prisma.automationResult.findMany({
      where: { automationRunId: run.id },
      orderBy: { position: 'asc' },
    });
    expect(results.map((r) => [r.name, r.status])).toEqual([
      ['Login', 'PASSED'],
      ['Me', 'PASSED'],
      ['Broken', 'FAILED'],
      ['checkout.spec.ts', 'PASSED'],
      ['fails.spec.ts', 'FAILED'],
      ['quarantined.spec.ts', 'FAILED'],
    ]);
    expect(results[2]!.error).toBe('Status 500, expected eq 200');
    // Secrets never reach stored results.
    expect(JSON.stringify(results)).not.toContain('shop-secret-999');
    const files = await prisma.attachment.findMany({
      where: { entityType: 'automation_result', entityId: results[4]!.id },
    });
    expect(files.map((f) => f.contentType)).toEqual(
      expect.arrayContaining(['application/zip', 'image/png']),
    );

    const done = await prisma.automationRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { testRun: { include: { results: true } } },
    });
    expect(done.status).toBe('FAILED');
    expect(done.testRun).toMatchObject({
      source: 'AUTOMATION',
      status: 'COMPLETED',
      build: 'b1',
      environmentId: envId,
    });
    expect(done.testRun!.results.map((r) => [r.testCaseId, r.status]).sort()).toEqual(
      [
        [caseA, 'PASSED'],
        [caseB, 'PASSED'],
      ].sort(),
    );
    const note = await prisma.notification.findFirstOrThrow({
      where: { userId, type: 'automation.failed' },
    });
    expect(note.title).toMatch(/^AUT-0001 failed: 3 of 6$/);
    const t = await prisma.automationTest.findFirstOrThrow({
      where: { projectId, path: 'checkout.spec.ts' },
    });
    expect(t.flakyScore).toBe(0);
  }, 180_000);

  it('runs a single collection and passes when everything passes', async () => {
    const col = await prisma.apiCollection.findFirstOrThrow({ where: { projectId } });
    await prisma.apiRequest.deleteMany({ where: { collectionId: col.id, name: 'Broken' } });
    const run = await prisma.$transaction((tx) =>
      insertAutomationRun(tx, {
        projectId,
        trigger: 'API',
        selection: { kind: 'collections', collectionIds: [col.id] },
        environmentId: envId,
        createdById: userId,
      }),
    );
    expect(await executeAutomationRun(run.id, { allowPrivate: true })).toMatchObject({
      status: 'PASSED',
      totals: { total: 2, passed: 2 },
    });
    // Re-delivery of a finished run does nothing.
    expect(await executeAutomationRun(run.id)).toEqual({ skipped: true });
  });

  it('blocks private addresses when not allowed', async () => {
    const col = await prisma.apiCollection.findFirstOrThrow({ where: { projectId } });
    const run = await prisma.$transaction((tx) =>
      insertAutomationRun(tx, {
        projectId,
        trigger: 'API',
        selection: { kind: 'collections', collectionIds: [col.id] },
        environmentId: envId,
        createdById: userId,
      }),
    );
    await executeAutomationRun(run.id, { allowPrivate: false });
    const r = await prisma.automationResult.findFirstOrThrow({
      where: { automationRunId: run.id },
    });
    expect(r.error).toMatch(/Blocked request to 127\.0\.0\.1/);
  });

  it('starts due schedules once, even with two workers', async () => {
    const s = await prisma.automationSchedule.create({
      data: {
        projectId,
        name: 'Nightly',
        cron: '0 2 * * *',
        selection: { kind: 'tags', tags: ['none'] },
        nextRunAt: new Date(Date.now() - 1000),
        createdById: userId,
      },
    });
    const queued: string[] = [];
    const [a, b] = await Promise.all([
      scheduleTick(async (id) => queued.push(id)),
      scheduleTick(async (id) => queued.push(id)),
    ]);
    expect(a.length + b.length).toBe(1);
    const run = await prisma.automationRun.findUniqueOrThrow({ where: { id: queued[0]! } });
    expect(run).toMatchObject({ trigger: 'SCHEDULE', scheduleId: s.id });
    const after = await prisma.automationSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await scheduleTick(async () => undefined)).toEqual([]);
  });
});

describe('automation agents (offline provider)', () => {
  const redis = { publish: async () => 1 } as never;
  const bull = (jobId: string) =>
    ({ data: { jobId }, attemptsMade: 0, opts: { attempts: 1 } }) as never;
  const startJob = (kind: string, input: object, agent: string) =>
    prisma.agentJob.create({
      data: {
        organizationId: orgId,
        projectId,
        agent,
        input: { kind, ...input },
        sourceIds: [],
        createdById: userId,
      },
    });

  it('repairs a broken locator from the failure snapshot (pending approval) and analyses the failure', async () => {
    const { createAiProcessor } = await import('../ai/processor');
    const process_ = createAiProcessor(redis);
    const t = await prisma.automationTest.create({
      data: {
        projectId,
        name: 'Pay now',
        path: 'pay-now.spec.ts',
        createdById: userId,
        updatedById: userId,
        code: `import { test, expect } from '@playwright/test';\ntest('pay', async ({ page }) => {\n  await page.goto('/');\n  await page.getByRole('button', { name: 'Pay now' }).click({ timeout: 500 });\n  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();\n});`,
      },
    });
    const run = await prisma.$transaction((tx) =>
      insertAutomationRun(tx, {
        projectId,
        trigger: 'MANUAL',
        selection: { kind: 'tests', testIds: [t.id] },
        environmentId: envId,
        retries: 0,
        createdById: userId,
      }),
    );
    await executeAutomationRun(run.id, { driver: new ProcessDriver(), allowPrivate: true });
    const result = await prisma.automationResult.findFirstOrThrow({
      where: { automationRunId: run.id },
    });
    expect(result.status).toBe('FAILED');

    const repair = await startJob(
      'repair-ui-test',
      { automationResultId: result.id },
      'automation',
    );
    await process_(bull(repair.id));
    const fixed = await prisma.automationTest.findUniqueOrThrow({ where: { id: t.id } });
    const fix = fixed.pendingFix as { code: string; summary: string };
    expect(fix.summary).toBe('The button is now called "Pay".');
    expect(fix.code).toContain("{ name: 'Pay' }");
    expect(fixed.code).toContain("'Pay now'"); // unchanged until a person approves

    const analysis = await startJob(
      'analyze-failure',
      { automationResultId: result.id },
      'failure-analysis',
    );
    await process_(bull(analysis.id));
    const analysed = await prisma.automationResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(analysed.failureClass).toBe('TEST_BUG');
    expect(analysed.analysis).toMatchObject({ locatorIssue: true });
  }, 120_000);

  it('drafts a disabled Playwright test from a test case', async () => {
    const { createAiProcessor } = await import('../ai/processor');
    const job = await startJob(
      'generate-ui-test',
      { testCaseId: caseA, environmentId: envId },
      'automation',
    );
    await createAiProcessor(redis)(bull(job.id));
    const done = await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe('SUCCEEDED');
    const t = await prisma.automationTest.findFirstOrThrow({ where: { aiJobId: job.id } });
    expect(t).toMatchObject({
      status: 'DISABLED',
      aiGenerated: true,
      testCaseId: caseA,
      tags: ['ai-draft'],
    });
    expect(t.path).toMatch(/^generated\/tc-0001-checkout-page-shows-pay\.spec\.ts$/);
    expect(t.code).toContain('class AppPage');
    // A second draft for the same case gets its own file.
    const again = await startJob('generate-ui-test', { testCaseId: caseA }, 'automation');
    await createAiProcessor(redis)(bull(again.id));
    expect(
      (await prisma.automationTest.findFirstOrThrow({ where: { aiJobId: again.id } })).path,
    ).toMatch(/-2\.spec\.ts$/);
  });

  it('queues failure analysis after a failed run only when AI is on', async () => {
    const { queueFailureAnalysis } = await import('./auto-analysis');
    const run = await prisma.automationRun.findFirstOrThrow({
      where: { projectId, status: 'FAILED', seq: 1 },
    });
    const added: string[] = [];
    const queue = {
      add: async (_n: string, d: { jobId: string }) => void added.push(d.jobId),
    } as never;
    await prisma.organization.update({
      where: { id: orgId },
      data: { settings: { ai: { enabled: false } } },
    });
    expect(await queueFailureAnalysis(run, queue)).toEqual([]);
    await prisma.organization.update({ where: { id: orgId }, data: { settings: {} } });
    const ids = await queueFailureAnalysis(run, queue);
    expect(ids.length).toBe(3);
    expect(added).toEqual(ids);
  });
});
