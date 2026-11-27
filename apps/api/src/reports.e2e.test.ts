import type { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStorage, getPrisma } from '@qaforge/db';
import { QUEUES } from '@qaforge/shared';
import { addMember, bootTestApp, createOrg, signUp, type TestUser } from './test/helpers';

let app: INestApplication;
let lead: TestUser;
let qa: TestUser;
let dev: TestUser;
let client: TestUser;
let pid: string;
let releaseId: string;
const prisma = getPrisma();
const base = () => `/v1/projects/${pid}`;

beforeAll(async () => {
  app = await bootTestApp();
  lead = await signUp(app, 'Report Lead');
  const orgId = (await createOrg(lead)).id;
  qa = await signUp(app, 'Report QA');
  dev = await signUp(app, 'Report Dev');
  client = await signUp(app, 'Report Client');
  await addMember(lead, orgId, qa, 'QA_ENGINEER');
  await addMember(lead, orgId, dev, 'DEVELOPER');
  await addMember(lead, orgId, client, 'CLIENT');
  pid = (
    await lead
      .agent('post', `/v1/orgs/${orgId}/projects`)
      .send({ name: 'Rep', key: 'REP' })
      .expect(201)
  ).body.id;
  releaseId = (
    await qa.agent('post', `${base()}/releases`).send({ name: 'R1', version: '1.0.0' }).expect(201)
  ).body.id;
});
afterAll(async () => {
  const q = new Queue(QUEUES.reports, {
    connection: new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
  });
  await q.obliterate({ force: true });
  await q.close();
  await app.close();
});

describe('reports', () => {
  let reportId: string;

  it('queues a report for the worker and checks what each type needs', async () => {
    await qa.agent('post', `${base()}/reports`).send({ type: 'GO_NO_GO' }).expect(400);
    await qa
      .agent('post', `${base()}/reports`)
      .send({ type: 'GO_NO_GO', params: { releaseId: '00000000-0000-4000-8000-000000000000' } })
      .expect(400);
    await dev.agent('post', `${base()}/reports`).send({ type: 'BUG_SUMMARY' }).expect(403);
    const res = await qa
      .agent('post', `${base()}/reports`)
      .send({ type: 'GO_NO_GO', params: { releaseId }, narrative: true })
      .expect(201);
    reportId = res.body.id;
    expect(res.body).toMatchObject({ status: 'QUEUED', title: 'Go / No-Go · REL-0001 R1' });
    const q = new Queue(QUEUES.reports, {
      connection: new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
    });
    const job = await q.getJob(`report-${reportId}`);
    expect(job?.data).toEqual({ kind: 'generate', reportId });
    await q.close();
    const stored = await prisma.report.findUniqueOrThrow({ where: { id: reportId } });
    expect(stored.params).toMatchObject({ releaseId, narrative: true });
  });

  it('lists reports for everyone who can read them, filtered by release', async () => {
    await qa.agent('post', `${base()}/reports`).send({ type: 'BUG_SUMMARY' }).expect(201);
    const all = (await client.agent('get', `${base()}/reports`).expect(200)).body;
    expect(all).toHaveLength(2);
    const forRelease = (
      await client.agent('get', `${base()}/reports?releaseId=${releaseId}`).expect(200)
    ).body;
    expect(forRelease).toHaveLength(1);
    expect(forRelease[0]).toMatchObject({
      release: { ref: 'REL-0001' },
      createdBy: 'Report QA',
      shared: false,
    });
  });

  it('shares a ready report with a read-only link that can be revoked', async () => {
    // Stand in for the worker: numbers + one export.
    await prisma.report.update({
      where: { id: reportId },
      data: { status: 'READY', data: { version: 1, title: 'Go / No-Go', kpis: [], sections: [] } },
    });
    const key = `test/${reportId}/go.pdf`;
    await createStorage().put(key, Buffer.from('%PDF-1.7 test'), 'application/pdf');
    const uid = (await prisma.user.findUniqueOrThrow({ where: { email: qa.email } })).id;
    await prisma.attachment.create({
      data: {
        projectId: pid,
        storageKey: key,
        fileName: 'go-no-go-rep.pdf',
        contentType: 'application/pdf',
        size: 13,
        entityType: 'report',
        entityId: reportId,
        scanStatus: 'SKIPPED',
        createdById: uid,
      },
    });

    await qa.agent('post', `${base()}/reports/${reportId}/share`).send({}).expect(403);
    const share = await lead
      .agent('post', `${base()}/reports/${reportId}/share`)
      .send({ expiresInDays: 7 })
      .expect(201);
    expect(share.body.token).toMatch(/^qaf_share_/);
    const stored = await prisma.report.findUniqueOrThrow({ where: { id: reportId } });
    expect(stored.shareTokenHash).not.toContain(share.body.token);

    const anon = request(app.getHttpServer());
    const view = await anon.get(`/v1/share/reports/${share.body.token}`).expect(200);
    expect(view.body).toMatchObject({ title: 'Go / No-Go · REL-0001 R1', exports: ['pdf'] });
    expect(view.body).not.toHaveProperty('projectId');
    expect(view.body).not.toHaveProperty('createdById');
    const file = await anon.get(`/v1/share/reports/${share.body.token}/files/pdf`).expect(302);
    const pdf = await anon.get(file.headers.location!).expect(200);
    expect(pdf.headers['content-disposition']).toMatch(/^attachment/);
    await anon.get(`/v1/share/reports/${share.body.token}/files/docx`).expect(404);

    await lead.agent('delete', `${base()}/reports/${reportId}/share`).expect(204);
    const gone = await anon.get(`/v1/share/reports/${share.body.token}`).expect(404);
    expect(gone.body.message).toMatch(/expired or was turned off/);
    await anon.get('/v1/share/reports/qaf_share_not-a-real-token-at-all').expect(404);
  });

  it('an expired link stops working', async () => {
    const share = await lead
      .agent('post', `${base()}/reports/${reportId}/share`)
      .send({ expiresInDays: 1 })
      .expect(201);
    await prisma.report.update({
      where: { id: reportId },
      data: { shareExpiresAt: new Date(Date.now() - 1000) },
    });
    await request(app.getHttpServer()).get(`/v1/share/reports/${share.body.token}`).expect(404);
  });

  it('schedules need a valid cron and recipients, and only leads manage them', async () => {
    const body = {
      name: 'Weekly bugs',
      type: 'BUG_SUMMARY',
      cron: '0 8 * * 1',
      timezone: 'Europe/London',
      recipients: ['pm@example.com'],
      formats: ['pdf', 'xlsx'],
    };
    await qa.agent('post', `${base()}/report-schedules`).send(body).expect(403);
    await lead
      .agent('post', `${base()}/report-schedules`)
      .send({ ...body, recipients: ['not-an-email'] })
      .expect(400);
    await lead
      .agent('post', `${base()}/report-schedules`)
      .send({ ...body, cron: '99 8 * * 1' })
      .expect(400);
    await lead
      .agent('post', `${base()}/report-schedules`)
      .send({ ...body, type: 'GO_NO_GO' })
      .expect(400);
    const s = (await lead.agent('post', `${base()}/report-schedules`).send(body).expect(201)).body;
    expect(new Date(s.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    const paused = (
      await lead
        .agent('patch', `${base()}/report-schedules/${s.id}`)
        .send({ enabled: false })
        .expect(200)
    ).body;
    expect(paused.nextRunAt).toBeNull();
    expect((await client.agent('get', `${base()}/report-schedules`).expect(200)).body).toHaveLength(
      1,
    );
    await lead.agent('delete', `${base()}/report-schedules/${s.id}`).expect(204);
  });

  it('deletes a report with its exports, and audits it', async () => {
    await qa.agent('delete', `${base()}/reports/${reportId}`).expect(204);
    expect(
      await prisma.attachment.count({ where: { entityType: 'report', entityId: reportId } }),
    ).toBe(0);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: reportId } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['create', 'share', 'unshare', 'delete']));
  });
});
