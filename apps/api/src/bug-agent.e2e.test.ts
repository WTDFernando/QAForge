import type { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@qaforge/db';
import { QUEUES } from '@qaforge/shared';
import { addMember, bootTestApp, createOrg, signUp, type TestUser } from './test/helpers';

let app: INestApplication;
let lead: TestUser;
let qa: TestUser;
let dev: TestUser;
let orgId: string;
let pid: string;
let envId: string;
const base = () => `/v1/projects/${pid}`;
const prisma = getPrisma();
const png = Buffer.from('89504e470d0a1a0a', 'hex');

beforeAll(async () => {
  app = await bootTestApp();
  lead = await signUp(app, 'BA Lead');
  orgId = (await createOrg(lead)).id;
  qa = await signUp(app, 'BA QA');
  dev = await signUp(app, 'BA Dev');
  await addMember(lead, orgId, qa, 'QA_ENGINEER');
  await addMember(lead, orgId, dev, 'DEVELOPER');
  pid = (
    await lead
      .agent('post', `/v1/orgs/${orgId}/projects`)
      .send({ name: 'BA', key: 'BA' })
      .expect(201)
  ).body.id;
  envId = (
    await lead
      .agent('post', `${base()}/environments`)
      .send({ name: 'Staging', secrets: { DB_PASSWORD: 'Very-S3cret-Value' } })
      .expect(201)
  ).body.id;
});
afterAll(async () => {
  const q = new Queue(QUEUES.ai, {
    connection: new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
  });
  await q.obliterate({ force: true });
  await q.close();
  await app.close();
});

const upload = (u: TestUser) =>
  u
    .agent('post', `${base()}/bugs/uploads`)
    .attach('file', png, { filename: 'shot.png', contentType: 'image/png' });

describe('quick report with the Bug Agent', () => {
  it('uploads a screenshot, queues a draft job and files an AI-assisted bug with the highlight', async () => {
    const shot = (await upload(qa).expect(201)).body;
    expect(shot).toMatchObject({ entityType: null, contentType: 'image/png' });

    const job = (
      await qa
        .agent('post', `${base()}/agent-jobs`)
        .send({
          kind: 'draft-bug',
          note: 'Discount code is ignored at checkout',
          attachmentId: shot.id,
          environmentId: envId,
          pageUrl: 'https://staging.shop.test/checkout',
        })
        .expect(201)
    ).body;
    expect(job).toMatchObject({ agent: 'bug', kind: 'draft-bug', status: 'QUEUED' });
    expect((await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).sourceType).toBe(
      'attachment',
    );

    // Simulate the worker finishing (the worker itself is covered by its own tests).
    await prisma.agentJob.update({
      where: { id: job.id },
      data: {
        status: 'SUCCEEDED',
        model: 'fake-model',
        output: {
          confidence: 0.7,
          rationale: 'Visible in the screenshot',
          missingInfo: ['Which code?'],
          duplicates: [{ id: 'x', ref: 'BUG-0001', title: 'Old', status: 'NEW', similarity: 0.4 }],
          draft: {},
        },
      },
    });

    const bug = await qa
      .agent('post', `${base()}/bugs`)
      .send({
        title: 'Discount code is ignored at checkout',
        severity: 'MAJOR',
        attachmentIds: [shot.id],
        attachmentAnnotations: {
          [shot.id]: [{ x: 0.25, y: 0.3, w: 0.5, h: 0.2, label: 'Total', source: 'ai' }],
        },
        aiJobId: job.id,
      })
      .expect(201);
    expect(bug.body).toMatchObject({ aiGenerated: true, aiJobId: job.id });
    expect(bug.body.aiNotes).toMatchObject({
      confidence: 0.7,
      duplicates: [{ ref: 'BUG-0001', similarity: 0.4 }],
      model: 'fake-model',
    });
    const detail = (await qa.agent('get', `${base()}/bugs/${bug.body.id}`).expect(200)).body;
    expect(detail.attachments[0]).toMatchObject({ id: shot.id });
    const a = await prisma.attachment.findUniqueOrThrow({ where: { id: shot.id } });
    expect(a).toMatchObject({ entityType: 'bug', entityId: bug.body.id });
    expect((a.annotations as { source: string }[])[0]!.source).toBe('ai');

    // The upload is now attached: it can't be reused for another bug.
    await qa
      .agent('post', `${base()}/bugs`)
      .send({ title: 'Again', attachmentIds: [shot.id] })
      .expect(400);
  });

  it('rejects other people’s uploads, unknown jobs and non-image files', async () => {
    const mine = (await upload(qa).expect(201)).body;
    // Developers can file bugs but not run AI agents.
    await dev
      .agent('post', `${base()}/agent-jobs`)
      .send({ kind: 'draft-bug', note: 'Broken page' })
      .expect(403);
    const devShot = (await upload(dev).expect(201)).body;
    await dev
      .agent('post', `${base()}/bugs`)
      .send({ title: 'Steal', attachmentIds: [mine.id] })
      .expect(400);
    await qa
      .agent('post', `${base()}/agent-jobs`)
      .send({ kind: 'draft-bug', note: 'Their shot', attachmentId: devShot.id })
      .expect(404);
    await qa
      .agent('post', `${base()}/bugs`)
      .send({ title: 'Fake AI', aiJobId: '00000000-0000-4000-8000-000000000000' })
      .expect(400);
    const queued = (
      await qa
        .agent('post', `${base()}/agent-jobs`)
        .send({ kind: 'draft-bug', note: 'Note only' })
        .expect(201)
    ).body;
    await qa
      .agent('post', `${base()}/bugs`)
      .send({ title: 'Too early', aiJobId: queued.id })
      .expect(400);
    await qa
      .agent('post', `${base()}/agent-jobs`)
      .send({ kind: 'draft-bug', note: 'x' })
      .expect(400);
    await qa
      .agent('post', `${base()}/bugs/uploads`)
      .attach('file', Buffer.from('MZ'), {
        filename: 'a.exe',
        contentType: 'application/x-msdownload',
      })
      .expect(400);
    const pdf = (
      await qa
        .agent('post', `${base()}/bugs/uploads`)
        .attach('file', Buffer.from('%PDF-1.4'), {
          filename: 'log.pdf',
          contentType: 'application/pdf',
        })
        .expect(201)
    ).body;
    await qa
      .agent('post', `${base()}/agent-jobs`)
      .send({ kind: 'draft-bug', note: 'From a PDF', attachmentId: pdf.id })
      .expect(400);
  });
});

describe('AI master switch', () => {
  it('turns every AI feature off for the organization and back on', async () => {
    const view = (await lead.agent('get', `/v1/orgs/${orgId}/ai-settings`).expect(200)).body;
    expect(view).toMatchObject({ enabled: true, ready: true });
    const off = await lead
      .agent('put', `/v1/orgs/${orgId}/ai-settings`)
      .send({ enabled: false, model: view.model, monthlyBudgetUsd: null, disabledAgents: [] })
      .expect(200);
    expect(off.body).toMatchObject({ enabled: false, ready: false });
    const res = await qa
      .agent('post', `${base()}/agent-jobs`)
      .send({ kind: 'draft-bug', note: 'Anything' })
      .expect(400);
    expect(res.body.message).toMatch(/turned off/);
    await qa
      .agent('post', `${base()}/copilot`)
      .send({ messages: [{ role: 'user', content: 'Hi' }] })
      .expect((r) => expect(r.text).toMatch(/turned off/));
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: orgId, entityType: 'ai_settings' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.changes).toMatchObject({ enabled: { from: true, to: false } });
    await lead
      .agent('put', `/v1/orgs/${orgId}/ai-settings`)
      .send({ enabled: true, model: view.model, monthlyBudgetUsd: null, disabledAgents: [] })
      .expect(200);
    await qa
      .agent('post', `${base()}/agent-jobs`)
      .send({ kind: 'draft-bug', note: 'Back on again' })
      .expect(201);
  });
});
