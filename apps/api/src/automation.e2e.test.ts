import { createServer, type Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@qaforge/db';
import { QUEUES } from '@qaforge/shared';
import { addMember, bootTestApp, createOrg, signUp, type TestUser } from './test/helpers';

let app: INestApplication;
let lead: TestUser;
let qa: TestUser;
let dev: TestUser;
let viewer: TestUser;
let pid: string;
let envId: string;
let server: Server;
let target = '';
const base = () => `/v1/projects/${pid}`;
const prisma = getPrisma();
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: req.url === '/health', auth: req.headers['x-api-key'] ?? null }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  target = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  app = await bootTestApp();
  lead = await signUp(app, 'Auto Lead');
  const orgId = (await createOrg(lead)).id;
  qa = await signUp(app, 'Auto QA');
  dev = await signUp(app, 'Auto Dev');
  viewer = await signUp(app, 'Auto Viewer');
  await addMember(lead, orgId, qa, 'QA_ENGINEER');
  await addMember(lead, orgId, dev, 'DEVELOPER');
  await addMember(lead, orgId, viewer, 'VIEWER');
  pid = (
    await lead
      .agent('post', `/v1/orgs/${orgId}/projects`)
      .send({ name: 'Auto', key: 'AUTO' })
      .expect(201)
  ).body.id;
  envId = (
    await lead
      .agent('post', `${base()}/environments`)
      .send({ name: 'Local', baseUrl: target, secrets: { API_KEY: 'k-secret-123456' } })
      .expect(201)
  ).body.id;
});
afterAll(async () => {
  const q = new Queue(QUEUES.automation, {
    connection: new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
  });
  await q.obliterate({ force: true });
  await q.close();
  server.close();
  await app.close();
});

describe('API testing', () => {
  let colId: string;
  it('creates collections and requests, and sends a request with env secrets redacted', async () => {
    colId = (
      await qa
        .agent('post', `${base()}/api-collections`)
        .send({
          name: 'Health',
          variables: { path: '/health' },
          auth: { type: 'apiKey', key: 'X-Api-Key', value: '{{env.API_KEY}}', in: 'header' },
        })
        .expect(201)
    ).body.id;
    const req = (
      await qa
        .agent('post', `${base()}/api-requests`)
        .send({
          collectionId: colId,
          name: 'Health check',
          url: '{{baseUrl}}{{path}}',
          assertions: [{ type: 'status', op: 'eq', value: '200' }],
        })
        .expect(201)
    ).body;
    expect(req).toMatchObject({ method: 'GET', position: 0 });
    const sent = (
      await qa
        .agent('post', `${base()}/api-requests/send`)
        .send({
          collectionId: colId,
          environmentId: envId,
          method: 'GET',
          url: '{{baseUrl}}{{path}}',
          auth: { type: 'inherit' },
          assertions: [{ type: 'jsonPath', path: '$.auth', op: 'eq', value: 'k-secret-123456' }],
        })
        .expect(200)
    ).body;
    expect(sent.passed).toBe(true);
    expect(JSON.stringify(sent)).not.toContain('k-secret-123456');
    const tree = (await viewer.agent('get', `${base()}/api-collections`).expect(200)).body;
    expect(tree[0].requests[0].name).toBe('Health check');
    await qa
      .agent('patch', `${base()}/api-requests/${req.id}`)
      .send({ auth: null, name: 'Health' })
      .expect(200);
    expect((await qa.agent('get', `${base()}/api-requests/${req.id}`)).body).toMatchObject({
      name: 'Health',
      auth: null,
    });
    await viewer.agent('post', `${base()}/api-collections`).send({ name: 'x' }).expect(403);
    await viewer
      .agent('post', `${base()}/api-requests/send`)
      .send({ collectionId: colId, method: 'GET', url: target })
      .expect(403);
  });

  it('imports Postman, OpenAPI and cURL, and explains bad files', async () => {
    const pm = await qa
      .agent('post', `${base()}/api-collections/import`)
      .send({
        format: 'postman',
        fileName: 'shop.json',
        content: JSON.stringify({
          info: { name: 'Shop' },
          item: [
            {
              name: 'A',
              item: [{ name: 'Ping', request: { method: 'GET', url: 'https://x.test/ping' } }],
            },
          ],
        }),
      })
      .expect(201);
    expect(pm.body).toMatchObject({ requests: 1, name: 'Shop' });
    const oas = await qa
      .agent('post', `${base()}/api-collections/import`)
      .send({
        format: 'openapi',
        content:
          'openapi: 3.0.0\ninfo: { title: Pets }\npaths:\n  /pets:\n    get:\n      responses: { "200": { description: ok } }\n',
      })
      .expect(201);
    expect(oas.body.requests).toBe(1);
    await qa
      .agent('post', `${base()}/api-collections/import`)
      .send({
        format: 'curl',
        content: "curl -X POST https://x.test/a -d 'a=1'",
        collectionId: colId,
      })
      .expect(201);
    expect(
      (await qa.agent('get', `${base()}/api-collections`)).body.find(
        (c: { id: string }) => c.id === colId,
      ).requests,
    ).toHaveLength(2);
    const bad = await qa
      .agent('post', `${base()}/api-collections/import`)
      .send({ format: 'postman', content: 'nope' })
      .expect(400);
    expect(bad.body.message).toMatch(/not valid JSON/);
  });

  it('blocks folder cycles and cleans up on delete', async () => {
    const child = (
      await qa
        .agent('post', `${base()}/api-collections`)
        .send({ name: 'Child', parentId: colId })
        .expect(201)
    ).body.id;
    await qa
      .agent('patch', `${base()}/api-collections/${colId}`)
      .send({ parentId: child })
      .expect(400);
    await qa.agent('delete', `${base()}/api-collections/${child}`).expect(204);
  });
});

describe('Playwright tests', () => {
  let testId: string;
  it('creates, edits with versions, detects edit conflicts and path clashes', async () => {
    const t = (
      await dev
        .agent('post', `${base()}/automation-tests`)
        .send({
          name: 'Home loads',
          path: 'smoke/home.spec.ts',
          code: "import { test } from '@playwright/test';\ntest('x', async () => {});",
          tags: ['Smoke'],
        })
        .expect(201)
    ).body;
    testId = t.id;
    expect(t).toMatchObject({ version: 1, tags: ['smoke'] });
    const v2 = (
      await dev
        .agent('patch', `${base()}/automation-tests/${testId}`)
        .send({ code: '// v2', version: 1 })
        .expect(200)
    ).body;
    expect(v2.version).toBe(2);
    const conflict = await dev
      .agent('patch', `${base()}/automation-tests/${testId}`)
      .send({ code: '// v3', version: 1 })
      .expect(409);
    expect(conflict.body.message).toMatch(/saved version 2/);
    await dev
      .agent('post', `${base()}/automation-tests`)
      .send({ name: 'Dup', path: 'smoke/home.spec.ts', code: '' })
      .expect(409);
    await dev
      .agent('post', `${base()}/automation-tests`)
      .send({ name: 'Bad', path: '../etc/passwd.spec.ts', code: '' })
      .expect(400);
    const detail = (await viewer.agent('get', `${base()}/automation-tests/${testId}`).expect(200))
      .body;
    expect(detail.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(
      (await viewer.agent('get', `${base()}/automation-tests/${testId}/versions/1`)).body.code,
    ).toContain("test('x'");
    const list = (await viewer.agent('get', `${base()}/automation-tests`).expect(200)).body;
    expect(list[0]).toMatchObject({
      path: 'smoke/home.spec.ts',
      lastResult: null,
      hasPendingFix: false,
    });
    await viewer
      .agent('patch', `${base()}/automation-tests/${testId}`)
      .send({ name: 'x' })
      .expect(403);
  });

  it('applies an approved AI fix as a new version', async () => {
    await prisma.automationTest.update({
      where: { id: testId },
      data: {
        pendingFix: {
          code: '// fixed',
          jobId: '00000000-0000-4000-8000-000000000001',
          explanation: 'x',
        },
      },
    });
    const r = (
      await qa.agent('post', `${base()}/automation-tests/${testId}/fix/approve`).expect(200)
    ).body;
    expect(r).toMatchObject({ pendingFix: null, version: 3, code: '// fixed' });
    await qa.agent('post', `${base()}/automation-tests/${testId}/fix/approve`).expect(400);
  });

  it('starts, lists, reads and cancels runs', async () => {
    const run = (
      await qa
        .agent('post', `${base()}/automation-runs`)
        .send({
          selection: { kind: 'tests', testIds: [testId] },
          environmentId: envId,
          build: '1.2.3',
        })
        .expect(201)
    ).body;
    expect(run).toMatchObject({ ref: 'AUT-0001', status: 'QUEUED', trigger: 'MANUAL' });
    expect(
      (await viewer.agent('get', `${base()}/automation-runs/AUT-0001`).expect(200)).body.id,
    ).toBe(run.id);
    expect((await viewer.agent('get', `${base()}/automation-runs`)).body[0].ref).toBe('AUT-0001');
    expect(
      (await qa.agent('post', `${base()}/automation-runs/${run.id}/cancel`).expect(200)).body
        .status,
    ).toBe('CANCELLED');
    await qa
      .agent('post', `${base()}/automation-runs`)
      .send({ selection: { kind: 'tests', testIds: ['00000000-0000-4000-8000-000000000000'] } })
      .expect(400);
    await viewer
      .agent('post', `${base()}/automation-runs`)
      .send({ selection: { kind: 'all' } })
      .expect(403);
  });
});

describe('schedules and CI', () => {
  it('validates cron and computes the next run; only leads configure', async () => {
    await qa
      .agent('post', `${base()}/automation-schedules`)
      .send({ name: 'Nightly', cron: '0 2 * * *', selection: { kind: 'all' } })
      .expect(403);
    await lead
      .agent('post', `${base()}/automation-schedules`)
      .send({ name: 'Bad', cron: '0 25 * * *', selection: { kind: 'all' } })
      .expect(400);
    await lead
      .agent('post', `${base()}/automation-schedules`)
      .send({ name: 'Bad', cron: '0 2 * * *', timezone: 'Mars/Base', selection: { kind: 'all' } })
      .expect(400);
    const s = (
      await lead
        .agent('post', `${base()}/automation-schedules`)
        .send({
          name: 'Nightly',
          cron: '0 2 * * *',
          timezone: 'Asia/Colombo',
          selection: { kind: 'all' },
        })
        .expect(201)
    ).body;
    expect(new Date(s.nextRunAt).getUTCMinutes()).toBe(30);
    const off = (
      await lead
        .agent('patch', `${base()}/automation-schedules/${s.id}`)
        .send({ enabled: false })
        .expect(200)
    ).body;
    expect(off.nextRunAt).toBeNull();
    await lead.agent('delete', `${base()}/automation-schedules/${s.id}`).expect(204);
  });

  it('CI webhook: token auth, idempotency, status polling, revocation', async () => {
    const created = (
      await lead.agent('post', `${base()}/ci-tokens`).send({ name: 'GitHub Actions' }).expect(201)
    ).body;
    expect(created.token).toMatch(/^qaf_ci_/);
    const listed = (await lead.agent('get', `${base()}/ci-tokens`).expect(200)).body;
    expect(JSON.stringify(listed)).not.toContain(created.token);
    const row = await prisma.projectToken.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.tokenHash).not.toBe(created.token);

    await http().post('/v1/hooks/automation').send({}).expect(401);
    await http()
      .post('/v1/hooks/automation')
      .set('Authorization', 'Bearer qaf_ci_wrong')
      .send({})
      .expect(401);
    const auth = { Authorization: `Bearer ${created.token}`, 'Idempotency-Key': 'pipeline-42' };
    const first = (
      await http()
        .post('/v1/hooks/automation')
        .set(auth)
        .send({ environment: 'local', build: 'sha-abc', ref: 'https://ci.test/42' })
        .expect(202)
    ).body;
    expect(first).toMatchObject({ status: 'QUEUED', duplicate: false, done: false });
    expect(first.url).toMatch(/\/p\/AUTO\/automation\/runs\/AUT-\d{4}$/);
    const again = (await http().post('/v1/hooks/automation').set(auth).send({}).expect(202)).body;
    expect(again).toMatchObject({ ref: first.ref, duplicate: true });
    await http()
      .post('/v1/hooks/automation')
      .set({ Authorization: auth.Authorization })
      .send({ environment: 'nope' })
      .expect(400);
    const status = (
      await http()
        .get(`/v1/hooks/automation/runs/${first.ref}`)
        .set({ Authorization: auth.Authorization })
        .expect(200)
    ).body;
    expect(status.ref).toBe(first.ref);
    const run = await prisma.automationRun.findUniqueOrThrow({ where: { id: first.id } });
    expect(run).toMatchObject({
      trigger: 'CI_WEBHOOK',
      build: 'sha-abc',
      environmentId: envId,
      triggerRef: 'https://ci.test/42',
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: first.id, action: 'start' },
    });
    expect(audit.actorType).toBe('API_TOKEN');

    await lead.agent('delete', `${base()}/ci-tokens/${created.id}`).expect(204);
    await http()
      .post('/v1/hooks/automation')
      .set({ Authorization: auth.Authorization })
      .send({})
      .expect(401);
  });

  it('pre-fills a bug from a failed result', async () => {
    const run = await prisma.automationRun.findFirstOrThrow({ where: { projectId: pid } });
    const res = await prisma.automationResult.create({
      data: {
        automationRunId: run.id,
        name: 'Health',
        status: 'FAILED',
        error: 'Status 500, expected eq 200',
        exchange: {
          request: { method: 'GET', url: 'https://x.test/health' },
          response: { status: 500, body: 'boom' },
        },
      },
    });
    const draft = (
      await qa.agent('get', `${base()}/automation-results/${res.id}/bug-draft`).expect(200)
    ).body;
    expect(draft).toMatchObject({
      stepsToReproduce: ['Send GET https://x.test/health'],
      actualResult: expect.stringContaining('Response 500: boom'),
    });
    expect(
      (await viewer.agent('get', `${base()}/automation-results/${res.id}`).expect(200)).body
        .attachments,
    ).toEqual([]);
  });
});
