import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, bootTestApp, createOrg, signUp, type TestUser } from './test/helpers';

let app: INestApplication;
let lead: TestUser;
let dev: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let orgId: string;
let pid: string;
let suiteId: string;
let tcA: string;
let tcB: string;
let tcData: string;
let devUserId: string;
const base = () => `/v1/projects/${pid}`;

beforeAll(async () => {
  app = await bootTestApp();
  lead = await signUp(app, 'Run Lead');
  orgId = (await createOrg(lead)).id;
  dev = await signUp(app, 'Run Dev');
  viewer = await signUp(app, 'Run Viewer');
  outsider = await signUp(app, 'Run Outsider');
  await addMember(lead, orgId, dev, 'DEVELOPER');
  await addMember(lead, orgId, viewer, 'VIEWER');
  devUserId = (await dev.agent('get', '/v1/me')).body.user.id;
  pid = (
    await lead
      .agent('post', `/v1/orgs/${orgId}/projects`)
      .send({ name: 'Runs', key: 'RUNS' })
      .expect(201)
  ).body.id;
  suiteId = (await lead.agent('post', `${base()}/suites`).send({ name: 'Checkout' }).expect(201))
    .body.id;
  tcA = (
    await lead
      .agent('post', `${base()}/test-cases`)
      .send({
        title: 'Pay with card',
        suiteId,
        steps: [
          { action: 'Open checkout', expected: 'Form shown' },
          { action: 'Pay', expected: 'Order placed' },
        ],
      })
      .expect(201)
  ).body.id;
  tcB = (
    await lead
      .agent('post', `${base()}/test-cases`)
      .send({
        title: 'Refund',
        priority: 'HIGH',
        steps: [{ action: 'Refund', expected: 'Refunded' }],
      })
      .expect(201)
  ).body.id;
  tcData = (
    await lead
      .agent('post', `${base()}/test-cases`)
      .send({
        title: 'Brands',
        suiteId,
        testData: { columns: ['brand'], rows: [['Visa'], ['Amex']] },
        steps: [{ action: 'Pay with {brand}', expected: 'Paid' }],
      })
      .expect(201)
  ).body.id;
  await lead
    .agent('post', `${base()}/test-cases`)
    .send({ title: 'Old', suiteId, status: 'DEPRECATED' });
});
afterAll(async () => {
  await app.close();
});

describe('test runs', () => {
  let runId: string;
  let results: Array<{
    id: string;
    ref: string;
    title: string;
    dataRow: Record<string, string> | null;
    status: string;
  }>;

  it('creates a run from a suite with one result per data row, skipping deprecated cases', async () => {
    const res = await lead
      .agent('post', `${base()}/test-runs`)
      .send({ name: 'Sprint 1', build: '1.4.0', selection: { kind: 'suite', suiteId } })
      .expect(201);
    runId = res.body.id;
    expect(res.body).toMatchObject({
      ref: 'RUN-0001',
      status: 'PLANNED',
      source: 'SUITE',
      counts: { total: 3, executed: 0, progressPct: 0, passRate: null },
    });
    results = (await lead.agent('get', `${base()}/test-runs/${runId}/results`).expect(200)).body;
    expect(results.map((r) => r.title)).toEqual(['Pay with card', 'Brands', 'Brands']);
    expect(results.filter((r) => r.dataRow).map((r) => r.dataRow!.brand)).toEqual(['Visa', 'Amex']);
  });

  it('creates runs from a filter or an explicit list and rejects empty selections', async () => {
    const byFilter = await lead
      .agent('post', `${base()}/test-runs`)
      .send({ name: 'High only', selection: { kind: 'filter', priority: ['HIGH'] } })
      .expect(201);
    expect(byFilter.body.counts.total).toBe(1);
    const byCases = await lead
      .agent('post', `${base()}/test-runs`)
      .send({ name: 'Pick', selection: { kind: 'cases', testCaseIds: [tcA, tcB] } })
      .expect(201);
    expect(byCases.body).toMatchObject({ ref: 'RUN-0003', counts: { total: 2 } });
    await lead
      .agent('post', `${base()}/test-runs`)
      .send({ name: 'None', selection: { kind: 'filter', tag: 'nothing' } })
      .expect(400);
    await lead
      .agent('post', `${base()}/test-runs`)
      .send({
        name: 'Approved',
        onlyApproved: true,
        selection: { kind: 'cases', testCaseIds: [tcA] },
      })
      .expect(400);
  });

  it('keeps a snapshot: editing the test case later does not change the run', async () => {
    await lead
      .agent('patch', `${base()}/test-cases/${tcA}`)
      .send({ title: 'Pay with card (edited)', steps: [{ action: 'x', expected: 'y' }] })
      .expect(200);
    const r = await lead.agent('get', `${base()}/run-results/${results[0]!.id}`).expect(200);
    expect(r.body.snapshot).toMatchObject({
      title: 'Pay with card',
      steps: [{ action: 'Open checkout' }, { action: 'Pay' }],
    });
    expect(r.body.testCaseVersion).toBe(1);
  });

  it('records results: developers can execute, the run starts automatically, steps are validated', async () => {
    const id = results[0]!.id;
    await viewer
      .agent('patch', `${base()}/run-results/${id}`)
      .send({ status: 'PASSED' })
      .expect(403);
    await dev
      .agent('patch', `${base()}/run-results/${id}`)
      .send({ status: 'FAILED', stepResults: [{ index: 9, status: 'FAILED' }] })
      .expect(400);
    const r = await dev
      .agent('patch', `${base()}/run-results/${id}`)
      .send({
        status: 'FAILED',
        stepResults: [{ index: 1, status: 'FAILED', actual: 'Spinner forever' }],
        notes: 'Gateway timeout',
        durationSec: 95,
      })
      .expect(200);
    expect(r.body).toMatchObject({ status: 'FAILED', executedById: devUserId, durationSec: 95 });
    await dev
      .agent('patch', `${base()}/run-results/${results[1]!.id}`)
      .send({ status: 'PASSED' })
      .expect(200);
    await dev
      .agent('patch', `${base()}/run-results/${results[2]!.id}`)
      .send({ status: 'SKIPPED' })
      .expect(200);
    const run = (await lead.agent('get', `${base()}/test-runs/${runId}`)).body;
    expect(run).toMatchObject({
      status: 'IN_PROGRESS',
      counts: { executed: 3, progressPct: 100, passRate: 50 },
    });
    expect(run.startedAt).toBeTruthy();
    // Resetting to untested clears the executor.
    expect(
      (
        await dev
          .agent('patch', `${base()}/run-results/${results[2]!.id}`)
          .send({ status: 'UNTESTED' })
      ).body.executedById,
    ).toBeNull();
    const audit = await lead.agent('get', `/v1/orgs/${orgId}/audit?entityId=${id}`).expect(200);
    expect(audit.body.items[0]).toMatchObject({
      action: 'execute',
      changes: { status: { from: 'UNTESTED', to: 'FAILED' } },
    });
  });

  it('assigns results and notifies the assignee; only managers assign others', async () => {
    await dev
      .agent('post', `${base()}/test-runs/${runId}/assign`)
      .send({ resultIds: [results[1]!.id], assigneeId: devUserId })
      .expect(403);
    await dev
      .agent('patch', `${base()}/run-results/${results[1]!.id}`)
      .send({ assigneeId: devUserId })
      .expect(200); // self-assign is fine
    const res = await lead
      .agent('post', `${base()}/test-runs/${runId}/assign`)
      .send({ resultIds: [results[0]!.id, results[2]!.id], assigneeId: devUserId })
      .expect(201);
    expect(res.body.updated).toBe(2);
    const mine = await dev
      .agent('get', `${base()}/test-runs/${runId}/results?assigneeId=me`)
      .expect(200);
    expect(mine.body).toHaveLength(3);
    const notes = await dev.agent('get', '/v1/notifications').expect(200);
    expect(notes.body.unread).toBe(1);
    expect(notes.body.items[0]).toMatchObject({
      type: 'run.assigned',
      title: 'You were assigned 2 tests in RUN-0001',
    });
    await dev.agent('post', `/v1/notifications/${notes.body.items[0].id}/read`).expect(200);
    expect((await dev.agent('get', '/v1/notifications?unreadOnly=true')).body.items).toHaveLength(
      0,
    );
    await lead
      .agent('post', `${base()}/test-runs/${runId}/assign`)
      .send({
        resultIds: [results[0]!.id],
        assigneeId: (await outsider.agent('get', '/v1/me')).body.user.id,
      })
      .expect(400);
  });

  it('filters results, adds cases without duplicates, and completes or reopens runs', async () => {
    expect(
      (await lead.agent('get', `${base()}/test-runs/${runId}/results?status=FAILED`)).body,
    ).toHaveLength(1);
    expect(
      (await lead.agent('get', `${base()}/test-runs/${runId}/results?q=brand`)).body,
    ).toHaveLength(2);
    const add = await lead
      .agent('post', `${base()}/test-runs/${runId}/cases`)
      .send({ testCaseIds: [tcA, tcB] })
      .expect(201);
    expect(add.body).toEqual({ added: 1, skipped: 1 });
    await lead
      .agent('patch', `${base()}/test-runs/${runId}`)
      .send({ status: 'PLANNED' })
      .expect(400);
    const done = await lead
      .agent('patch', `${base()}/test-runs/${runId}`)
      .send({ status: 'COMPLETED' })
      .expect(200);
    expect(done.body.completedAt).toBeTruthy();
    await dev
      .agent('patch', `${base()}/run-results/${results[1]!.id}`)
      .send({ status: 'FAILED' })
      .expect(400);
    await lead
      .agent('patch', `${base()}/test-runs/${runId}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);
    await dev.agent('patch', `${base()}/test-runs/${runId}`).send({ name: 'x' }).expect(403);
  });

  it('lists with counts, finds by ref, deletes, and isolates tenants', async () => {
    const list = await viewer.agent('get', `${base()}/test-runs`).expect(200);
    expect(list.body.total).toBe(3);
    expect(list.body.items[0].ref).toBe('RUN-0003');
    expect((await lead.agent('get', `${base()}/test-runs?status=IN_PROGRESS`)).body.total).toBe(1);
    expect((await lead.agent('get', `${base()}/test-runs/by-ref/1`).expect(200)).body.id).toBe(
      runId,
    );
    await outsider.agent('get', `${base()}/test-runs/${runId}`).expect(404);
    await outsider
      .agent('patch', `${base()}/run-results/${results[0]!.id}`)
      .send({ status: 'PASSED' })
      .expect(404);
    const otherOrg = (await createOrg(outsider)).id;
    const otherPid = (
      await outsider
        .agent('post', `/v1/orgs/${otherOrg}/projects`)
        .send({ name: 'Other', key: 'ORUN' })
        .expect(201)
    ).body.id;
    await outsider
      .agent('get', `/v1/projects/${otherPid}/run-results/${results[0]!.id}`)
      .expect(404);
    await outsider
      .agent('post', `/v1/projects/${otherPid}/test-runs`)
      .send({ name: 'steal', selection: { kind: 'cases', testCaseIds: [tcA] } })
      .expect(400);
    await lead.agent('delete', `${base()}/test-runs/${runId}`).expect(204);
    await lead.agent('get', `${base()}/test-runs/${runId}`).expect(404);
    expect(tcData).toBeTruthy();
  });
});
