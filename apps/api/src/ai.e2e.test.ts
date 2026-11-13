import type { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, Prisma } from '@qaforge/db';
import { agentJobChannel, QUEUES } from '@qaforge/shared';
import { addMember, bootTestApp, createOrg, signUp, type TestUser } from './test/helpers';

let app: INestApplication;
let owner: TestUser;
let qa: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let orgId: string;
let pid: string;
let reqId: string;
let tcId: string;
const base = () => `/v1/projects/${pid}`;
const prisma = getPrisma();

beforeAll(async () => {
  app = await bootTestApp();
  owner = await signUp(app, 'AI Owner');
  orgId = (await createOrg(owner)).id;
  qa = await signUp(app, 'AI QA');
  viewer = await signUp(app, 'AI Viewer');
  outsider = await signUp(app, 'AI Outsider');
  await addMember(owner, orgId, qa, 'QA_ENGINEER');
  await addMember(owner, orgId, viewer, 'VIEWER');
  pid = (
    await owner
      .agent('post', `/v1/orgs/${orgId}/projects`)
      .send({ name: 'AI Shop', key: 'AIS' })
      .expect(201)
  ).body.id;
  reqId = (
    await qa
      .agent('post', `${base()}/requirements`)
      .send({ title: 'Pay by card', acceptanceCriteria: ['Card accepted'] })
      .expect(201)
  ).body.id;
  tcId = (
    await qa
      .agent('post', `${base()}/test-cases`)
      .send({ title: 'Pay with Visa', steps: [{ action: 'Pay', expected: 'Paid' }] })
      .expect(201)
  ).body.id;
});
afterAll(async () => {
  // Leave no queued jobs behind for other suites.
  const q = new Queue(QUEUES.ai, {
    connection: new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
  });
  await q.obliterate({ force: true });
  await q.close();
  await app.close();
});

describe('AI settings', () => {
  it('defaults to Claude Opus 5.5 and never returns or audits the key', async () => {
    const get = await qa.agent('get', `/v1/orgs/${orgId}/ai-settings`).expect(200);
    expect(get.body).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      hasApiKey: false,
      disabledAgents: [],
    });
    const put = await owner
      .agent('put', `/v1/orgs/${orgId}/ai-settings`)
      .send({
        model: 'claude-sonnet-5-5',
        apiKey: 'sk-ant-test-0123456789abcdef',
        monthlyBudgetUsd: 25,
        disabledAgents: [],
      })
      .expect(200);
    expect(put.body).toMatchObject({
      model: 'claude-sonnet-5-5',
      hasApiKey: true,
      monthlyBudgetUsd: 25,
    });
    expect(JSON.stringify(put.body)).not.toContain('sk-ant');
    const stored = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(JSON.stringify(stored.settings)).not.toContain('sk-ant-test'); // encrypted at rest
    const audit = await owner
      .agent('get', `/v1/orgs/${orgId}/audit?entityType=ai_settings`)
      .expect(200);
    expect(JSON.stringify(audit.body)).not.toContain('sk-ant');
    expect(audit.body.items[0].changes.apiKey).toEqual({ from: 'not set', to: 'set' });
    // Omitting apiKey keeps it; null removes it.
    expect(
      (
        await owner
          .agent('put', `/v1/orgs/${orgId}/ai-settings`)
          .send({ model: 'claude-opus-5-5', monthlyBudgetUsd: null })
          .expect(200)
      ).body.hasApiKey,
    ).toBe(true);
    expect(
      (
        await owner
          .agent('put', `/v1/orgs/${orgId}/ai-settings`)
          .send({ model: 'claude-opus-5-5', apiKey: null, monthlyBudgetUsd: null })
          .expect(200)
      ).body.hasApiKey,
    ).toBe(false);
  });

  it('validates input and restricts configuration to admins', async () => {
    await owner
      .agent('put', `/v1/orgs/${orgId}/ai-settings`)
      .send({ model: 'gpt-4', monthlyBudgetUsd: null })
      .expect(400);
    await qa
      .agent('put', `/v1/orgs/${orgId}/ai-settings`)
      .send({ model: 'claude-opus-5-5', monthlyBudgetUsd: null })
      .expect(403);
    await qa.agent('get', `/v1/orgs/${orgId}/ai-usage`).expect(403);
    await outsider.agent('get', `/v1/orgs/${orgId}/ai-settings`).expect(404);
  });
});

describe('agent jobs', () => {
  let jobId: string;

  it('queues a job, publishes an event and deduplicates repeat clicks', async () => {
    const sub = new IORedis(process.env.REDIS_URL!);
    const got = new Promise<string>((resolve) => sub.on('message', (_c, m) => resolve(m)));
    await sub.subscribe(agentJobChannel(orgId));
    const res = await qa
      .agent('post', `${base()}/agent-jobs`)
      .send({ kind: 'generate-test-cases', requirementIds: [reqId] })
      .expect(201);
    jobId = res.body.id;
    expect(res.body).toMatchObject({
      status: 'QUEUED',
      agent: 'test-case-writer',
      kind: 'generate-test-cases',
      sourceIds: [reqId],
    });
    expect(JSON.parse(await got)).toMatchObject({ id: jobId, status: 'QUEUED' });
    sub.disconnect();
    const q = new Queue(QUEUES.ai, {
      connection: new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
    });
    expect((await q.getJob(jobId))?.data).toEqual({ jobId });
    await q.close();
    const again = await qa
      .agent('post', `${base()}/agent-jobs`)
      .send({ kind: 'generate-test-cases', requirementIds: [reqId] })
      .expect(201);
    expect(again.body.id).toBe(jobId);
  });

  it('lists, reads and cancels jobs', async () => {
    expect(
      (await viewer.agent('get', `${base()}/agent-jobs?sourceId=${reqId}`).expect(200)).body.map(
        (j: { id: string }) => j.id,
      ),
    ).toEqual([jobId]);
    expect((await qa.agent('get', `/v1/orgs/${orgId}/agent-jobs`).expect(200)).body[0].id).toBe(
      jobId,
    );
    await viewer.agent('post', `${base()}/agent-jobs/${jobId}/cancel`).expect(403);
    const c = await qa.agent('post', `${base()}/agent-jobs/${jobId}/cancel`).expect(201);
    expect(c.body.status).toBe('CANCELLED');
    expect((await qa.agent('get', `${base()}/agent-jobs/${jobId}`).expect(200)).body.status).toBe(
      'CANCELLED',
    );
  });

  it('checks permissions, sources and project scope', async () => {
    await viewer
      .agent('post', `${base()}/agent-jobs`)
      .send({ kind: 'review-test-case', testCaseId: tcId })
      .expect(403);
    await qa
      .agent('post', `${base()}/agent-jobs`)
      .send({ kind: 'review-test-case', testCaseId: '00000000-0000-4000-8000-000000000000' })
      .expect(404);
    await qa.agent('post', `${base()}/agent-jobs`).send({ kind: 'nope' }).expect(400);
    const link = await qa
      .agent('post', `${base()}/requirement-sources/link`)
      .send({ name: 'Figma', url: 'https://figma.com/x' })
      .expect(201);
    await qa
      .agent('post', `${base()}/agent-jobs`)
      .send({ kind: 'analyze-source', sourceId: link.body.id })
      .expect(400);
    await outsider
      .agent('post', `${base()}/agent-jobs`)
      .send({ kind: 'review-test-case', testCaseId: tcId })
      .expect(404);
    // A requirement from another org's project is rejected even via a valid project of the caller.
    const otherOrg = (await createOrg(outsider)).id;
    const otherPid = (
      await outsider
        .agent('post', `/v1/orgs/${otherOrg}/projects`)
        .send({ name: 'Other', key: 'OTA' })
        .expect(201)
    ).body.id;
    await outsider
      .agent('post', `/v1/projects/${otherPid}/agent-jobs`)
      .send({ kind: 'generate-test-cases', requirementIds: [reqId] })
      .expect(404);
  });

  it('respects disabled agents and the monthly budget', async () => {
    await owner
      .agent('put', `/v1/orgs/${orgId}/ai-settings`)
      .send({
        model: 'claude-opus-5-5',
        monthlyBudgetUsd: null,
        disabledAgents: ['test-case-reviewer'],
      })
      .expect(200);
    const off = await qa
      .agent('post', `${base()}/agent-jobs`)
      .send({ kind: 'review-test-case', testCaseId: tcId })
      .expect(400);
    expect(off.body.message).toMatch(/disabled/);
    await owner
      .agent('put', `/v1/orgs/${orgId}/ai-settings`)
      .send({ model: 'claude-opus-5-5', monthlyBudgetUsd: 1, disabledAgents: [] })
      .expect(200);
    await prisma.aiUsage.create({
      data: {
        organizationId: orgId,
        projectId: pid,
        agent: 'copilot',
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        inputTokens: 100000,
        outputTokens: 50000,
        costUsd: new Prisma.Decimal(1.4),
      },
    });
    const budget = await qa
      .agent('post', `${base()}/agent-jobs`)
      .send({ kind: 'review-test-case', testCaseId: tcId })
      .expect(400);
    expect(budget.body.message).toMatch(/budget/);
    const usage = await owner.agent('get', `/v1/orgs/${orgId}/ai-usage`).expect(200);
    expect(usage.body).toMatchObject({
      totalCostUsd: 1.4,
      monthlyBudgetUsd: 1,
      byAgent: [{ agent: 'copilot', calls: 1, inputTokens: 100000 }],
    });
    expect(usage.body.daily).toHaveLength(1);
    await owner
      .agent('put', `/v1/orgs/${orgId}/ai-settings`)
      .send({ model: 'claude-opus-5-5', monthlyBudgetUsd: null, disabledAgents: [] })
      .expect(200);
  });

  it('refuses to run when no key is configured (real provider)', async () => {
    const prev = process.env.QAFORGE_AI_PROVIDER;
    process.env.QAFORGE_AI_PROVIDER = '';
    try {
      const res = await qa
        .agent('post', `${base()}/agent-jobs`)
        .send({ kind: 'review-test-case', testCaseId: tcId })
        .expect(400);
      expect(res.body.message).toMatch(/API key/);
    } finally {
      process.env.QAFORGE_AI_PROVIDER = prev;
    }
  });
});

describe('QA Copilot', () => {
  it('streams an answer grounded in project data', async () => {
    const res = await qa
      .agent('post', `${base()}/copilot`)
      .send({ messages: [{ role: 'user', content: 'How is coverage?' }] })
      .buffer(true)
      .parse((r, cb) => {
        let text = '';
        r.on('data', (c: Buffer) => (text += c.toString()));
        r.on('end', () => cb(null, text));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = String(res.body)
      .split('\n\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l.replace(/^data: /, '')));
    expect(events[0]).toMatchObject({ type: 'tool', name: 'project_overview' });
    expect(
      events
        .filter((e) => e.type === 'text')
        .map((e) => e.delta)
        .join(''),
    ).toContain('1 requirements');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('validates the conversation and permissions', async () => {
    await qa
      .agent('post', `${base()}/copilot`)
      .send({ messages: [{ role: 'assistant', content: 'hi' }] })
      .expect(400);
    await viewer
      .agent('post', `${base()}/copilot`)
      .send({ messages: [{ role: 'user', content: 'hi' }] })
      .expect(403);
    await owner
      .agent('put', `/v1/orgs/${orgId}/ai-settings`)
      .send({ model: 'claude-opus-5-5', monthlyBudgetUsd: null, disabledAgents: ['copilot'] })
      .expect(200);
    await qa
      .agent('post', `${base()}/copilot`)
      .send({ messages: [{ role: 'user', content: 'hi' }] })
      .expect(400);
  });

  it('exposes the job stream for org members only', async () => {
    await outsider.agent('get', `/v1/orgs/${orgId}/agent-jobs/stream`).expect(404);
    await request(app.getHttpServer()).get(`/v1/orgs/${orgId}/agent-jobs/stream`).expect(401);
  });
});
