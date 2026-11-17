import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, bootTestApp, createOrg, signUp, type TestUser } from './test/helpers';

let app: INestApplication;
let lead: TestUser;
let qa: TestUser;
let dev: TestUser;
let client: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let orgId: string;
let pid: string;
let ids: Record<string, string>;
let tcId: string;
let resultId: string;
let envId: string;
const base = () => `/v1/projects/${pid}`;
const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

beforeAll(async () => {
  app = await bootTestApp();
  lead = await signUp(app, 'Bug Lead');
  orgId = (await createOrg(lead)).id;
  qa = await signUp(app, 'Bug QA');
  dev = await signUp(app, 'Bug Dev');
  client = await signUp(app, 'Bug Client');
  viewer = await signUp(app, 'Bug Viewer');
  outsider = await signUp(app, 'Bug Outsider');
  await addMember(lead, orgId, qa, 'QA_ENGINEER');
  await addMember(lead, orgId, dev, 'DEVELOPER');
  await addMember(lead, orgId, client, 'CLIENT');
  await addMember(lead, orgId, viewer, 'VIEWER');
  ids = Object.fromEntries(
    await Promise.all(
      [lead, qa, dev, client, viewer].map(async (u, i) => [
        ['lead', 'qa', 'dev', 'client', 'viewer'][i]!,
        (await u.agent('get', '/v1/me')).body.user.id,
      ]),
    ),
  );
  pid = (
    await lead
      .agent('post', `/v1/orgs/${orgId}/projects`)
      .send({ name: 'Bugs', key: 'BUGS' })
      .expect(201)
  ).body.id;
  envId = (await lead.agent('post', `${base()}/environments`).send({ name: 'Staging' }).expect(201))
    .body.id;
  tcId = (
    await qa
      .agent('post', `${base()}/test-cases`)
      .send({ title: 'Checkout with card', steps: [{ action: 'Pay', expected: 'Paid' }] })
      .expect(201)
  ).body.id;
  const run = await lead
    .agent('post', `${base()}/test-runs`)
    .send({
      name: 'Smoke',
      build: '2.1.0',
      environmentId: envId,
      selection: { kind: 'cases', testCaseIds: [tcId] },
    })
    .expect(201);
  resultId = (await lead.agent('get', `${base()}/test-runs/${run.body.id}/results`)).body[0].id;
  await qa
    .agent('patch', `${base()}/run-results/${resultId}`)
    .send({ status: 'FAILED', stepResults: [{ index: 0, status: 'FAILED', actual: '500 error' }] })
    .expect(200);
});
afterAll(async () => {
  await app.close();
});

describe('bugs', () => {
  let bugId: string;
  let dupId: string;

  it('reports a bug from a failed step with run context filled in', async () => {
    const res = await qa
      .agent('post', `${base()}/bugs`)
      .send({
        title: 'Checkout returns 500 on card payment',
        description: doc('Server error'),
        stepsToReproduce: ['Add item', 'Pay'],
        expectedResult: 'Order placed',
        actualResult: '500 error',
        severity: 'CRITICAL',
        testRunResultId: resultId,
        failedStepIndex: 0,
        assigneeId: ids.dev,
      })
      .expect(201);
    bugId = res.body.id;
    expect(res.body).toMatchObject({
      ref: 'BUG-0001',
      status: 'NEW',
      environmentId: envId,
      envDetails: { build: '2.1.0' },
    });
    const full = await viewer.agent('get', `${base()}/bugs/${bugId}`).expect(200);
    expect(full.body.testCases.map((t: { ref: string }) => t.ref)).toEqual(['TC-0001']);
    expect(full.body.foundIn).toMatchObject({
      run: { ref: 'RUN-0001' },
      testCase: { ref: 'TC-0001' },
      failedStep: { index: 0, action: 'Pay' },
    });
    expect(full.body.descriptionText).toBe('Server error');
    const n = await dev.agent('get', '/v1/notifications').expect(200);
    expect(n.body.items[0]).toMatchObject({
      type: 'bug.assigned',
      title: 'BUG-0001 was assigned to you',
    });
    const result = await qa.agent('get', `${base()}/run-results/${resultId}`).expect(200);
    expect(result.body.bugs[0].ref).toBe('BUG-0001');
  });

  it('validates references and permissions', async () => {
    await viewer.agent('post', `${base()}/bugs`).send({ title: 'x' }).expect(403);
    await client.agent('post', `${base()}/bugs`).send({ title: 'x' }).expect(403);
    await qa
      .agent('post', `${base()}/bugs`)
      .send({ title: 'x', assigneeId: '00000000-0000-4000-8000-000000000000' })
      .expect(400);
    await qa
      .agent('post', `${base()}/bugs`)
      .send({ title: 'x', testCaseIds: ['00000000-0000-4000-8000-000000000000'] })
      .expect(400);
    await outsider.agent('get', `${base()}/bugs/${bugId}`).expect(404);
  });

  it('enforces the workflow and notifies the reporter', async () => {
    await dev
      .agent('post', `${base()}/bugs/${bugId}/status`)
      .send({ status: 'READY_FOR_RETEST' })
      .expect(400);
    await dev
      .agent('post', `${base()}/bugs/${bugId}/status`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);
    const fixed = await dev
      .agent('post', `${base()}/bugs/${bugId}/status`)
      .send({ status: 'FIXED' })
      .expect(200);
    expect(fixed.body.resolution).toBe('FIXED');
    await dev
      .agent('post', `${base()}/bugs/${bugId}/status`)
      .send({ status: 'READY_FOR_RETEST' })
      .expect(200);
    const n = await qa.agent('get', '/v1/notifications').expect(200);
    expect(n.body.items[0]).toMatchObject({
      type: 'bug.ready_for_retest',
      title: 'BUG-0001 is now ready for retest',
    });
    await qa.agent('post', `${base()}/bugs/${bugId}/status`).send({ status: 'CLOSED' }).expect(400); // needs a resolution
    const closed = await qa
      .agent('post', `${base()}/bugs/${bugId}/status`)
      .send({ status: 'CLOSED', resolution: 'FIXED' })
      .expect(200);
    expect(closed.body.closedAt).toBeTruthy();
    const reopened = await qa
      .agent('post', `${base()}/bugs/${bugId}/status`)
      .send({ status: 'REOPENED' })
      .expect(200);
    expect(reopened.body).toMatchObject({ closedAt: null, resolution: null });
  });

  it('closes duplicates against the original and orders the Kanban column', async () => {
    dupId = (
      await qa
        .agent('post', `${base()}/bugs`)
        .send({ title: 'Checkout 500 when paying by card' })
        .expect(201)
    ).body.id;
    const similar = await qa
      .agent(
        'get',
        `${base()}/bugs/similar?title=${encodeURIComponent('Checkout returns 500 on card')}`,
      )
      .expect(200);
    expect(similar.body.map((s: { ref: string }) => s.ref)).toContain('BUG-0001');
    await qa
      .agent('post', `${base()}/bugs/${dupId}/status`)
      .send({ status: 'CLOSED', resolution: 'DUPLICATE', duplicateOfId: dupId })
      .expect(400);
    await qa
      .agent('post', `${base()}/bugs/${dupId}/status`)
      .send({ status: 'CLOSED', resolution: 'DUPLICATE', duplicateOfId: bugId })
      .expect(200);
    expect(
      (await qa.agent('get', `${base()}/bugs/${bugId}`)).body.duplicates.map(
        (d: { ref: string }) => d.ref,
      ),
    ).toEqual(['BUG-0002']);
    const a = (
      await qa
        .agent('post', `${base()}/bugs`)
        .send({ title: 'Typo on receipt', severity: 'TRIVIAL' })
        .expect(201)
    ).body.id;
    const b = (
      await qa
        .agent('post', `${base()}/bugs`)
        .send({ title: 'Logo blurry', severity: 'MINOR' })
        .expect(201)
    ).body.id;
    await qa
      .agent('post', `${base()}/bugs/${b}/status`)
      .send({ status: 'NEW', beforeId: a })
      .expect(200); // reorder within column
    const board = (await qa.agent('get', `${base()}/bugs/board`).expect(200)).body as {
      id: string;
      status: string;
    }[];
    const newCol = board.filter((x) => x.status === 'NEW').map((x) => x.id);
    expect(newCol.indexOf(b)).toBeLessThan(newCol.indexOf(a));
    expect(board.some((x) => x.id === dupId && x.status === 'CLOSED')).toBe(true);
  });

  it('filters, searches, edits with versioning and soft-deletes with undo', async () => {
    expect((await dev.agent('get', `${base()}/bugs?assigneeId=me`)).body.total).toBe(1);
    expect((await qa.agent('get', `${base()}/bugs?severity=TRIVIAL,MINOR`)).body.total).toBe(2);
    expect((await qa.agent('get', `${base()}/bugs?openOnly=true`)).body.total).toBe(3);
    expect((await qa.agent('get', `${base()}/bugs?q=BUG-0001`)).body.items[0].id).toBe(bugId);
    expect((await qa.agent('get', `${base()}/bugs?testCaseId=${tcId}`)).body.total).toBe(1);
    const upd = await dev
      .agent('patch', `${base()}/bugs/${bugId}`)
      .send({ component: 'Payments', severity: 'BLOCKER' })
      .expect(200);
    expect(upd.body.version).toBe(2);
    expect((await qa.agent('get', `${base()}/bugs/components`)).body).toEqual([
      { component: 'Payments', count: 1 },
    ]);
    await qa.agent('patch', `${base()}/bugs/${bugId}`).send({ testCaseIds: [] }).expect(200);
    expect((await qa.agent('get', `${base()}/bugs/${bugId}`)).body.testCases).toEqual([]);
    await qa.agent('delete', `${base()}/bugs/${dupId}`).expect(204);
    await qa.agent('get', `${base()}/bugs/${dupId}`).expect(404);
    await qa.agent('post', `${base()}/bugs/${dupId}/restore`).expect(204);
    expect((await qa.agent('get', `${base()}/bugs/by-ref/2`).expect(200)).body.id).toBe(dupId);
  });

  it('stores evidence with highlight annotations and validates them', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const up = await qa
      .agent('post', `${base()}/bugs/${bugId}/attachments`)
      .field(
        'annotations',
        JSON.stringify([{ x: 0.1, y: 0.2, w: 0.3, h: 0.1, label: 'Error banner' }]),
      )
      .attach('file', png, { filename: 'shot.png', contentType: 'image/png' })
      .expect(201);
    expect(up.body.annotations[0]).toMatchObject({ label: 'Error banner', source: 'user' });
    await qa
      .agent('post', `${base()}/bugs/${bugId}/attachments`)
      .field('annotations', '[{"x":5}]')
      .attach('file', png, { filename: 's.png', contentType: 'image/png' })
      .expect(400);
    await qa
      .agent('post', `${base()}/bugs/${bugId}/attachments`)
      .attach('file', Buffer.from('MZ'), {
        filename: 'a.exe',
        contentType: 'application/x-msdownload',
      })
      .expect(400);
    await qa
      .agent('patch', `${base()}/attachments/${up.body.id}/annotations`)
      .send({ annotations: [] })
      .expect(200);
    expect((await qa.agent('get', `${base()}/bugs/${bugId}`)).body.attachments).toHaveLength(1);
    const ev = await qa
      .agent('post', `${base()}/run-results/${resultId}/attachments`)
      .attach('file', png, { filename: 'step.png', contentType: 'image/png' })
      .expect(201);
    expect(
      (await qa.agent('get', `${base()}/run-results/${resultId}`)).body.attachments[0].id,
    ).toBe(ev.body.id);
  });
});

describe('comments', () => {
  let bugId: string;
  it('notifies mentions and watchers; only authors edit; viewers cannot comment', async () => {
    bugId = (
      await qa
        .agent('post', `${base()}/bugs`)
        .send({ title: 'Cart badge wrong', assigneeId: ids.dev })
        .expect(201)
    ).body.id;
    await viewer
      .agent('post', `${base()}/comments/bug/${bugId}`)
      .send({ body: doc('hi') })
      .expect(403);
    await dev
      .agent('post', `${base()}/comments/bug/${bugId}`)
      .send({ body: { type: 'doc', content: [] } })
      .expect(400);
    const c = await client
      .agent('post', `${base()}/comments/bug/${bugId}`)
      .send({
        body: doc('Seen on prod too, @Lead'),
        mentions: [ids.lead, '00000000-0000-4000-8000-000000000000'],
      })
      .expect(201);
    expect(c.body.mentions).toEqual([ids.lead]);
    expect((await lead.agent('get', '/v1/notifications')).body.items[0]).toMatchObject({
      type: 'mention',
      title: 'You were mentioned on BUG-0005',
    });
    const watchers = await Promise.all(
      [qa, dev].map(async (u) => (await u.agent('get', '/v1/notifications')).body.items[0]),
    );
    expect(watchers.map((w) => w.type)).toEqual(['comment', 'comment']);
    const list = await viewer.agent('get', `${base()}/comments/bug/${bugId}`).expect(200);
    expect(list.body[0]).toMatchObject({
      bodyText: 'Seen on prod too, @Lead',
      author: { name: 'Bug Client' },
    });
    await dev
      .agent('patch', `${base()}/comments/${c.body.id}`)
      .send({ body: doc('edited') })
      .expect(403);
    expect(
      (
        await client
          .agent('patch', `${base()}/comments/${c.body.id}`)
          .send({ body: doc('edited') })
          .expect(200)
      ).body.editedAt,
    ).toBeTruthy();
    await dev.agent('delete', `${base()}/comments/${c.body.id}`).expect(403);
    await lead.agent('delete', `${base()}/comments/${c.body.id}`).expect(204);
    await qa.agent('get', `${base()}/comments/nope/${bugId}`).expect(400);
    await qa.agent('get', `${base()}/comments/test_case/${bugId}`).expect(404);
    await qa
      .agent('post', `${base()}/comments/test_case/${tcId}`)
      .send({ body: doc('Step 2 is vague') })
      .expect(201);
  });

  it('links notifications to the item and shows card counts on the board', async () => {
    await qa
      .agent('post', `${base()}/comments/bug/${bugId}`)
      .send({ body: doc('Counted on the card'), mentions: [] })
      .expect(201);
    const list = (await lead.agent('get', '/v1/notifications')).body;
    const bugNote = list.items.find((n: { entityType: string }) => n.entityType === 'bug');
    expect(bugNote.href).toMatch(/^\/org-[^/]+\/p\/BUGS\/bugs\/BUG-\d{4}$/);
    const board = (await lead.agent('get', `${base()}/bugs/board`).expect(200)).body as {
      ref: string;
      commentCount: number;
      attachmentCount: number;
      aiConfidence: number | null;
    }[];
    expect(board.some((b) => b.commentCount > 0)).toBe(true);
    expect(board.some((b) => b.attachmentCount > 0)).toBe(true);
    expect(board[0]).toHaveProperty('aiConfidence');
  });

  it('marks all notifications read', async () => {
    await lead.agent('post', '/v1/notifications/read-all').expect(200);
    expect((await lead.agent('get', '/v1/notifications')).body.unread).toBe(0);
  });
});

describe('project roles and dashboard', () => {
  it('overrides a member role inside one project only', async () => {
    await qa
      .agent('put', `${base()}/members/${ids.client}`)
      .send({ role: 'QA_ENGINEER' })
      .expect(403);
    await lead.agent('put', `${base()}/members/${ids.lead}`).send({ role: 'VIEWER' }).expect(403); // owners keep their role
    await lead
      .agent('put', `${base()}/members/${ids.client}`)
      .send({ role: 'QA_ENGINEER' })
      .expect(200);
    await client.agent('post', `${base()}/bugs`).send({ title: 'Client as QA here' }).expect(201);
    const members = await lead.agent('get', `${base()}/members`).expect(200);
    expect(
      members.body.find((m: { user: { id: string } }) => m.user.id === ids.client),
    ).toMatchObject({
      orgRole: 'CLIENT',
      projectRole: 'QA_ENGINEER',
      effectiveRole: 'QA_ENGINEER',
    });
    const other = (
      await lead
        .agent('post', `/v1/orgs/${orgId}/projects`)
        .send({ name: 'Other', key: 'OTHR' })
        .expect(201)
    ).body.id;
    await client.agent('post', `/v1/projects/${other}/bugs`).send({ title: 'x' }).expect(403); // org role still applies elsewhere
    await lead.agent('put', `${base()}/members/${ids.qa}`).send({ role: 'VIEWER' }).expect(200);
    await qa.agent('post', `${base()}/bugs`).send({ title: 'x' }).expect(403); // overrides can also restrict
    await lead.agent('delete', `${base()}/members/${ids.qa}`).expect(204);
    await qa.agent('post', `${base()}/bugs`).send({ title: 'Back to QA' }).expect(201);
  });

  it('shows run and bug metrics on the dashboard', async () => {
    const d = await dev.agent('get', `${base()}/dashboard`).expect(200);
    expect(d.body.lastRun).toMatchObject({ ref: 'RUN-0001', passRate: 0, total: 1, failed: 1 });
    expect(d.body.openBugsBySeverity.BLOCKER).toBe(1);
    expect(d.body.attention.failedTests[0]).toMatchObject({
      ref: 'TC-0001',
      run: { ref: 'RUN-0001' },
      hasBug: true,
    });
    expect(d.body.attention.myBugs.map((b: { ref: string }) => b.ref)).toEqual([
      'BUG-0001',
      'BUG-0005',
    ]);
  });
});
