import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@qaforge/db';
import { addMember, bootTestApp, createOrg, signUp, type TestUser } from './test/helpers';

let app: INestApplication;
let lead: TestUser;
let qa: TestUser;
let client: TestUser;
let dev: TestUser;
let orgId: string;
let pid: string;
const ids = {} as Record<'reqHigh' | 'reqLow' | 'run' | 'failed' | 'untested' | 'bug', string>;
const base = () => `/v1/projects/${pid}/releases`;
const prisma = getPrisma();
const userId = async (u: TestUser) =>
  (await prisma.user.findUniqueOrThrow({ where: { email: u.email } })).id;

beforeAll(async () => {
  app = await bootTestApp();
  lead = await signUp(app, 'Rel Lead');
  orgId = (await createOrg(lead)).id;
  qa = await signUp(app, 'Rel QA');
  client = await signUp(app, 'Rel Client');
  dev = await signUp(app, 'Rel Dev');
  await addMember(lead, orgId, qa, 'QA_ENGINEER');
  await addMember(lead, orgId, client, 'CLIENT');
  await addMember(lead, orgId, dev, 'DEVELOPER');
  pid = (
    await lead
      .agent('post', `/v1/orgs/${orgId}/projects`)
      .send({ name: 'Rel', key: 'REL' })
      .expect(201)
  ).body.id;
  const uid = await userId(lead);
  const who = { projectId: pid, createdById: uid, updatedById: uid };
  // Two requirements (one high priority), three cases, one run with results, one critical bug.
  const reqHigh = await prisma.requirement.create({
    data: { ...who, seq: 1, title: 'Pay by card', priority: 'HIGH' },
  });
  const reqLow = await prisma.requirement.create({
    data: { ...who, seq: 2, title: 'Receipt email', priority: 'LOW' },
  });
  const cases = await Promise.all(
    [1, 2, 3].map((seq) => prisma.testCase.create({ data: { ...who, seq, title: `Case ${seq}` } })),
  );
  await prisma.requirementTestCase.createMany({
    data: [
      { requirementId: reqHigh.id, testCaseId: cases[0]!.id, createdById: uid },
      { requirementId: reqHigh.id, testCaseId: cases[1]!.id, createdById: uid },
      { requirementId: reqLow.id, testCaseId: cases[2]!.id, createdById: uid },
    ],
  });
  const run = await prisma.testRun.create({
    data: { ...who, seq: 1, name: 'Regression', status: 'IN_PROGRESS' },
  });
  const results = await Promise.all(
    cases.map((c, i) =>
      prisma.testRunResult.create({
        data: {
          testRunId: run.id,
          testCaseId: c.id,
          testCaseVersion: 1,
          snapshot: { title: c.title },
          position: i,
          // case 1 passed, case 2 failed, case 3 not run yet
          status: i === 0 ? 'PASSED' : i === 1 ? 'FAILED' : 'UNTESTED',
          executedAt: i < 2 ? new Date() : null,
        },
      }),
    ),
  );
  const bug = await prisma.bug.create({
    data: {
      ...who,
      seq: 1,
      title: 'Card declined for valid card',
      severity: 'CRITICAL',
      testRunResultId: results[1]!.id,
    },
  });
  Object.assign(ids, {
    reqHigh: reqHigh.id,
    reqLow: reqLow.id,
    run: run.id,
    failed: results[1]!.id,
    untested: results[2]!.id,
    bug: bug.id,
  });
});
afterAll(async () => {
  await app.close();
});

describe('releases', () => {
  let rel: string;

  it('creates a release with default gates and rejects a duplicate version', async () => {
    const res = await qa
      .agent('post', base())
      .send({ name: 'Spring release', version: '2.4.0', targetDate: '2026-12-15' })
      .expect(201);
    rel = res.body.id;
    expect(res.body.ref).toBe('REL-0001');
    await qa.agent('post', base()).send({ name: 'Again', version: '2.4.0' }).expect(409);
    await dev.agent('post', base()).send({ name: 'Nope', version: '9.9.9' }).expect(403);
  });

  it('measures scope, runs and bugs live', async () => {
    await qa
      .agent('post', `${base()}/${rel}/scope`)
      .send({ add: { requirementIds: [ids.reqHigh, ids.reqLow], testRunIds: [ids.run] } })
      .expect(201);
    const r = (await client.agent('get', `${base()}/REL-0001`).expect(200)).body;
    expect(r.requirements).toHaveLength(2);
    expect(r.testRuns).toHaveLength(1);
    expect(r.bugs).toHaveLength(1); // found in the release run
    expect(r.metrics).toMatchObject({
      passRate: 50,
      executionComplete: 66.7,
      requirementCoverage: 50,
      openBugs: { CRITICAL: 1 },
    });
    const byMetric = Object.fromEntries(r.gates.map((g: { metric: string }) => [g.metric, g]));
    expect(byMetric.OPEN_BUGS).toMatchObject({ actual: 1, passed: false, blocking: true });
    expect(r.readiness.band).toBe('BLOCKED');
  });

  it('refuses scope from another project', async () => {
    const other = (
      await lead
        .agent('post', `/v1/orgs/${orgId}/projects`)
        .send({ name: 'Other', key: 'OTH' })
        .expect(201)
    ).body.id;
    const uid = await userId(lead);
    const foreign = await prisma.requirement.create({
      data: { projectId: other, seq: 1, title: 'Not yours', createdById: uid, updatedById: uid },
    });
    await qa
      .agent('post', `${base()}/${rel}/scope`)
      .send({ add: { requirementIds: [foreign.id] } })
      .expect(400);
  });

  it('only lets people who can approve be named approvers', async () => {
    await lead
      .agent('put', `${base()}/${rel}/approvers`)
      .send({ approvers: [{ userId: await userId(dev), roleLabel: 'Developer' }] })
      .expect(400);
    await qa
      .agent('put', `${base()}/${rel}/approvers`)
      .send({ approvers: [{ userId: await userId(lead), roleLabel: 'QA Lead' }] })
      .expect(403);
    await lead
      .agent('put', `${base()}/${rel}/approvers`)
      .send({
        approvers: [
          { userId: await userId(lead), roleLabel: 'QA Lead' },
          { userId: await userId(client), roleLabel: 'Client' },
        ],
      })
      .expect(200);
  });

  it('won’t ask for approval while a blocking gate fails', async () => {
    const res = await lead.agent('post', `${base()}/${rel}/request-approval`).expect(409);
    expect(res.body.message).toMatch(/blocking quality gate/);
  });

  it('requests approval once gates pass, then approvers sign off', async () => {
    // Fix the failures: close the bug, pass the failed case, run the last one.
    await prisma.bug.update({
      where: { id: ids.bug },
      data: { status: 'CLOSED', resolution: 'FIXED' },
    });
    await prisma.testRunResult.updateMany({
      where: { id: { in: [ids.failed, ids.untested] } },
      data: { status: 'PASSED', executedAt: new Date() },
    });
    // Relax pass rate to show gate editing works.
    await qa
      .agent('put', `${base()}/${rel}/gates`)
      .send({
        gates: [
          { metric: 'PASS_RATE', operator: 'GTE', threshold: 100 },
          {
            metric: 'OPEN_BUGS',
            operator: 'LTE',
            threshold: 0,
            params: { severities: ['BLOCKER', 'CRITICAL'] },
          },
          { metric: 'HIGH_PRIORITY_COVERAGE', operator: 'GTE', threshold: 100, blocking: false },
        ],
      })
      .expect(200);
    const req = await lead.agent('post', `${base()}/${rel}/request-approval`).expect(200);
    expect(req.body.status).toBe('PENDING_APPROVAL');
    const frozen = await prisma.release.findUniqueOrThrow({ where: { id: rel } });
    expect((frozen.gateSnapshot as { readiness: { score: number } }).readiness.score).toBe(100);
    // Scope is locked while approval is pending.
    await qa
      .agent('post', `${base()}/${rel}/scope`)
      .send({ add: { bugIds: [ids.bug] } })
      .expect(409);
    // The approver was notified.
    const note = await prisma.notification.findFirst({
      where: { userId: await userId(client), type: 'release.approval_requested' },
    });
    expect(note?.title).toMatch(/REL-0001 Spring release needs your approval/);

    await qa.agent('post', `${base()}/${rel}/decision`).send({ decision: 'APPROVED' }).expect(403);
    const first = await lead
      .agent('post', `${base()}/${rel}/decision`)
      .send({ decision: 'APPROVED' })
      .expect(200);
    expect(first.body.status).toBe('PENDING_APPROVAL');
    await lead
      .agent('post', `${base()}/${rel}/decision`)
      .send({ decision: 'APPROVED' })
      .expect(409);
    const second = await client
      .agent('post', `${base()}/${rel}/decision`)
      .send({ decision: 'APPROVED', comment: 'Looks good' })
      .expect(200);
    expect(second.body.status).toBe('APPROVED');
    const approvals = await prisma.approval.findMany({ where: { releaseId: rel } });
    expect(approvals.every((a) => a.status === 'APPROVED' && a.gateSnapshot)).toBe(true);
  });

  it('ships an approved release and keeps the audit trail', async () => {
    await lead.agent('post', `${base()}/${rel}/release`).expect(200);
    const r = (await qa.agent('get', `${base()}/${rel}`).expect(200)).body;
    expect(r.status).toBe('RELEASED');
    await lead.agent('delete', `${base()}/${rel}`).expect(400);
    const actions = (
      await prisma.auditLog.findMany({ where: { entityId: rel }, orderBy: { createdAt: 'asc' } })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'create',
        'update_scope',
        'update_approvers',
        'update_gates',
        'request_approval',
        'approve',
        'release',
      ]),
    );
  });

  it('a rejection needs a reason and sends the release back for rework', async () => {
    const r2 = (
      await qa.agent('post', base()).send({ name: 'Hotfix', version: '2.4.1' }).expect(201)
    ).body.id;
    await qa.agent('put', `${base()}/${r2}/gates`).send({ gates: [] }).expect(200);
    await lead
      .agent('put', `${base()}/${r2}/approvers`)
      .send({ approvers: [{ userId: await userId(client), roleLabel: 'Client' }] })
      .expect(200);
    await lead.agent('post', `${base()}/${r2}/request-approval`).expect(200);
    await client
      .agent('post', `${base()}/${r2}/decision`)
      .send({ decision: 'REJECTED' })
      .expect(400);
    const rej = await client
      .agent('post', `${base()}/${r2}/decision`)
      .send({ decision: 'REJECTED', comment: 'Refund flow not tested' })
      .expect(200);
    expect(rej.body.status).toBe('REJECTED');
    // Scope can change again after a rejection; reopening resets approvals.
    await qa
      .agent('post', `${base()}/${r2}/scope`)
      .send({ add: { bugIds: [ids.bug] } })
      .expect(201);
    await lead.agent('post', `${base()}/${r2}/reopen`).expect(200);
    const a = await prisma.approval.findFirstOrThrow({ where: { releaseId: r2 } });
    expect(a.status).toBe('PENDING');
    const list = (await client.agent('get', base()).expect(200)).body;
    expect(list.map((x: { ref: string }) => x.ref)).toEqual(
      expect.arrayContaining(['REL-0001', 'REL-0002']),
    );
  });
});
