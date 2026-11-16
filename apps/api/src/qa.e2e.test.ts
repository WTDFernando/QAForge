import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { addMember, bootTestApp, createOrg, signUp, type TestUser } from './test/helpers';

let app: INestApplication;
let owner: TestUser;
let qa: TestUser;
let client: TestUser;
let dev: TestUser;
let outsider: TestUser;
let orgId: string;
let pid: string;
const base = () => `/v1/projects/${pid}`;
let storyId = '';

beforeAll(async () => {
  app = await bootTestApp();
  owner = await signUp(app, 'Owner QA');
  orgId = (await createOrg(owner)).id;
  qa = await signUp(app, 'Quinn QA');
  client = await signUp(app, 'Cleo Client');
  dev = await signUp(app, 'Devon Dev');
  await addMember(owner, orgId, qa, 'QA_ENGINEER');
  await addMember(owner, orgId, client, 'CLIENT');
  await addMember(owner, orgId, dev, 'DEVELOPER');
  outsider = await signUp(app, 'Out Sider');
  pid = (
    await owner
      .agent('post', `/v1/orgs/${orgId}/projects`)
      .send({ name: 'Shop', key: 'SHOP' })
      .expect(201)
  ).body.id;
});
afterAll(async () => {
  await app.close();
});

describe('project settings & environments', () => {
  it('toggles module flags (partial merge)', async () => {
    await owner
      .agent('patch', base().replace('/v1/projects', '/v1/projects'))
      .send({ modules: { performance: true } })
      .expect(200);
    const res = await owner
      .agent('patch', base())
      .send({ modules: { security: true } })
      .expect(200);
    expect(res.body.settings.modules).toEqual({ performance: true, security: true });
    await owner
      .agent('patch', base())
      .send({ modules: { nope: true } })
      .expect(400);
  });

  it('stores secrets encrypted and never returns their values', async () => {
    const env = await owner
      .agent('post', `${base()}/environments`)
      .send({
        name: 'Staging',
        baseUrl: 'https://staging.shop.test',
        variables: { USER: 'qa' },
        secrets: { PASSWORD: 's3cret!' },
      })
      .expect(201);
    expect(env.body.secretKeys).toEqual(['PASSWORD']);
    expect(JSON.stringify(env.body)).not.toContain('s3cret');
    const upd = await owner
      .agent('patch', `${base()}/environments/${env.body.id}`)
      .send({ secrets: { PASSWORD: null, TOKEN: 't' } })
      .expect(200);
    expect(upd.body.secretKeys).toEqual(['TOKEN']);
    const list = await qa.agent('get', `${base()}/environments`).expect(200);
    expect(list.body).toHaveLength(1);
    await owner.agent('post', `${base()}/environments`).send({ name: 'Staging' }).expect(409);
    await qa.agent('post', `${base()}/environments`).send({ name: 'Dev' }).expect(403);
    const audit = await owner
      .agent('get', `/v1/orgs/${orgId}/audit?entityId=${env.body.id}`)
      .expect(200);
    expect(JSON.stringify(audit.body)).not.toContain('s3cret');
    await owner.agent('delete', `${base()}/environments/${env.body.id}`).expect(204);
    await owner.agent('delete', `${base()}/environments/${env.body.id}`).expect(404);
  });
});

describe('requirements', () => {
  let epic: string;
  let feature: string;
  let story: string;

  it('creates an Epic > Feature > Story tree with refs and rich text', async () => {
    epic = (
      await qa
        .agent('post', `${base()}/requirements`)
        .send({ title: 'Checkout', type: 'EPIC' })
        .expect(201)
    ).body.id;
    const f = await qa
      .agent('post', `${base()}/requirements`)
      .send({ title: 'Pay by card', type: 'FEATURE', parentId: epic })
      .expect(201);
    feature = f.body.id;
    expect(f.body.ref).toBe('REQ-0002');
    const s = await qa
      .agent('post', `${base()}/requirements`)
      .send({
        title: 'Card declined shows error',
        parentId: feature,
        priority: 'HIGH',
        description: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'When the bank declines' }] },
          ],
        },
        acceptanceCriteria: ['Error message is shown', 'Card is not charged'],
      })
      .expect(201);
    story = s.body.id;
    expect(s.body.descriptionText).toBe('When the bank declines');
    const list = await client.agent('get', `${base()}/requirements`).expect(200);
    expect(list.body.map((r: { ref: string }) => r.ref)).toEqual([
      'REQ-0001',
      'REQ-0002',
      'REQ-0003',
    ]);
    expect(list.body[2]).toMatchObject({
      acceptanceCriteriaCount: 2,
      testCaseCount: 0,
      type: 'STORY',
    });
  });

  it('enforces hierarchy and prevents cycles', async () => {
    await qa
      .agent('post', `${base()}/requirements`)
      .send({ title: 'Bad', type: 'EPIC', parentId: feature })
      .expect(400);
    await qa
      .agent('post', `${base()}/requirements/${epic}/move`)
      .send({ parentId: story })
      .expect(400);
    await qa
      .agent('patch', `${base()}/requirements/${feature}`)
      .send({ type: 'STORY' })
      .expect(400);
    await qa
      .agent('post', `${base()}/requirements`)
      .send({ title: 'Orphan', parentId: '00000000-0000-4000-8000-000000000000' })
      .expect(400);
  });

  it('versions content edits and records audit diffs', async () => {
    await qa
      .agent('patch', `${base()}/requirements/${story}`)
      .send({ title: 'Declined card shows a clear error' })
      .expect(200);
    await qa
      .agent('patch', `${base()}/requirements/${story}`)
      .send({ title: 'Declined card shows a clear error' })
      .expect(200);
    const versions = await qa.agent('get', `${base()}/requirements/${story}/versions`).expect(200);
    expect(versions.body.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const audit = await owner.agent('get', `/v1/orgs/${orgId}/audit?entityId=${story}`).expect(200);
    expect(audit.body.items[0].changes.title.to).toBe('Declined card shows a clear error');
  });

  it('reorders siblings via move', async () => {
    const f2 = (
      await qa
        .agent('post', `${base()}/requirements`)
        .send({ title: 'Pay by wallet', type: 'FEATURE', parentId: epic })
        .expect(201)
    ).body.id;
    await qa
      .agent('post', `${base()}/requirements/${f2}/move`)
      .send({ parentId: epic, beforeId: feature })
      .expect(201);
    const list = (await qa.agent('get', `${base()}/requirements`)).body as Array<{
      id: string;
      parentId: string;
      position: number;
    }>;
    const kids = list.filter((r) => r.parentId === epic).sort((a, b) => a.position - b.position);
    expect(kids.map((k) => k.id)).toEqual([f2, feature]);
  });

  it('read-only roles cannot write; outsiders cannot see', async () => {
    await client.agent('post', `${base()}/requirements`).send({ title: 'x' }).expect(403);
    await dev.agent('patch', `${base()}/requirements/${story}`).send({ title: 'x' }).expect(403);
    await outsider.agent('get', `${base()}/requirements`).expect(404);
    await outsider.agent('get', `${base()}/requirements/${story}`).expect(404);
  });

  it('soft-deletes a subtree and restores it (undo)', async () => {
    const del = await qa.agent('delete', `${base()}/requirements/${feature}`).expect(200);
    expect(del.body.ids).toHaveLength(2);
    await qa.agent('get', `${base()}/requirements/${story}`).expect(404);
    await qa
      .agent('post', `${base()}/requirements/restore`)
      .send({ ids: del.body.ids })
      .expect(201);
    await qa.agent('get', `${base()}/requirements/${story}`).expect(200);
  });

  it('uploads requirement documents and serves them safely', async () => {
    const up = await qa
      .agent('post', `${base()}/requirement-sources/upload`)
      .attach('file', Buffer.from('# Checkout spec\nUsers can pay by card.'), {
        filename: 'spec.md',
        contentType: 'application/octet-stream',
      })
      .expect(201);
    expect(up.body).toMatchObject({ kind: 'FILE', status: 'UPLOADED', name: 'spec.md' });
    expect(up.body.attachment.contentType).toBe('text/markdown');
    const dl = await client
      .agent('get', `${base()}/attachments/${up.body.attachment.id}/download`)
      .expect(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.text ?? dl.body.toString()).toContain('Users can pay by card');
    await qa
      .agent('post', `${base()}/requirement-sources/upload`)
      .attach('file', Buffer.from('MZ...'), {
        filename: 'evil.exe',
        contentType: 'application/x-msdownload',
      })
      .expect(400);
    await qa.agent('post', `${base()}/requirement-sources/upload`).expect(400);
    await qa
      .agent('post', `${base()}/requirement-sources/link`)
      .send({ name: 'Figma flows', url: 'https://www.figma.com/file/abc' })
      .expect(201);
    const sources = await qa.agent('get', `${base()}/requirement-sources`).expect(200);
    expect(sources.body).toHaveLength(2);
    await outsider
      .agent('get', `${base()}/attachments/${up.body.attachment.id}/download`)
      .expect(404);
    await qa.agent('delete', `${base()}/requirement-sources/${up.body.id}`).expect(204);
  });

  it('exposes the story id for linking tests', () => {
    expect(story).toBeTruthy();
    storyId = story;
  });
});

describe('suites, test cases and traceability', () => {
  let suite: string;
  let sub: string;
  let tc1: string;
  let tc2: string;
  let shared: string;
  const story = () => storyId;

  it('builds a suite tree', async () => {
    suite = (await qa.agent('post', `${base()}/suites`).send({ name: 'Checkout' }).expect(201)).body
      .id;
    sub = (
      await qa
        .agent('post', `${base()}/suites`)
        .send({ name: 'Cards', parentId: suite })
        .expect(201)
    ).body.id;
    await qa.agent('post', `${base()}/suites/${suite}/move`).send({ parentId: sub }).expect(400);
    await qa.agent('patch', `${base()}/suites/${sub}`).send({ name: 'Card payments' }).expect(200);
  });

  it('creates test cases with steps, shared steps, data and requirement links', async () => {
    shared = (
      await qa
        .agent('post', `${base()}/shared-steps`)
        .send({
          name: 'Log in as shopper',
          steps: [
            { action: 'Open /login', expected: 'Form shown' },
            { action: 'Sign in', expected: 'Home shown' },
          ],
        })
        .expect(201)
    ).body.id;
    const res = await qa
      .agent('post', `${base()}/test-cases`)
      .send({
        title: 'Declined card shows error',
        suiteId: sub,
        steps: [
          { sharedStepId: shared },
          { action: 'Pay with card 4000 0000 0000 0002', expected: 'Error "Card declined" shown' },
        ],
        testData: { columns: ['card'], rows: [['4000000000000002'], ['4000000000009995']] },
        priority: 'HIGH',
        technique: 'NEGATIVE',
        tags: ['Payments', 'smoke'],
        requirementIds: [story()],
      })
      .expect(201);
    tc1 = res.body.id;
    expect(res.body.ref).toBe('TC-0001');
    tc2 = (
      await qa
        .agent('post', `${base()}/test-cases`)
        .send({ title: 'Successful card payment', suiteId: suite, tags: ['payments'] })
        .expect(201)
    ).body.id;
    const full = await client.agent('get', `${base()}/test-cases/${tc1}`).expect(200);
    expect(full.body.steps[0].sharedStep.name).toBe('Log in as shopper');
    expect(full.body.requirements[0].ref).toBe('REQ-0003');
    expect(full.body.tags).toEqual(['payments', 'smoke']);
    const req = await qa.agent('get', `${base()}/requirements/${story()}`).expect(200);
    expect(req.body.testCases.map((t: { ref: string }) => t.ref)).toEqual(['TC-0001']);
    await qa
      .agent('post', `${base()}/test-cases`)
      .send({ title: 'x', suiteId: '00000000-0000-4000-8000-000000000000' })
      .expect(400);
    await qa.agent('delete', `${base()}/shared-steps/${shared}`).expect(400);
  });

  it('filters, searches, sorts and paginates', async () => {
    const all = await qa.agent('get', `${base()}/test-cases?suiteId=${suite}`).expect(200);
    expect(all.body.total).toBe(2);
    const shallow = await qa
      .agent('get', `${base()}/test-cases?suiteId=${suite}&deep=false`)
      .expect(200);
    expect(shallow.body.items.map((t: { id: string }) => t.id)).toEqual([tc2]);
    expect((await qa.agent('get', `${base()}/test-cases?q=declined`)).body.total).toBe(1);
    expect((await qa.agent('get', `${base()}/test-cases?q=TC-0002`)).body.items[0].id).toBe(tc2);
    expect((await qa.agent('get', `${base()}/test-cases?priority=HIGH,CRITICAL`)).body.total).toBe(
      1,
    );
    expect((await qa.agent('get', `${base()}/test-cases?tag=smoke`)).body.total).toBe(1);
    expect(
      (await qa.agent('get', `${base()}/test-cases?requirementId=${story()}`)).body.total,
    ).toBe(1);
    const page = await qa
      .agent('get', `${base()}/test-cases?sort=title&dir=desc&pageSize=1&page=2`)
      .expect(200);
    expect(page.body).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(page.body.items[0].title).toBe('Declined card shows error');
    const tags = await qa.agent('get', `${base()}/test-cases/tags`).expect(200);
    expect(tags.body[0]).toEqual({ tag: 'payments', count: 2 });
    await qa.agent('get', `${base()}/test-cases?status=BOGUS`).expect(400);
  });

  it('runs the review workflow with role-based approval', async () => {
    await qa
      .agent('post', `${base()}/test-cases/${tc1}/status`)
      .send({ status: 'IN_REVIEW' })
      .expect(201);
    await qa
      .agent('post', `${base()}/test-cases/${tc1}/status`)
      .send({ status: 'APPROVED' })
      .expect(403);
    await dev
      .agent('post', `${base()}/test-cases/${tc1}/status`)
      .send({ status: 'APPROVED' })
      .expect(403);
    await client
      .agent('post', `${base()}/test-cases/${tc1}/status`)
      .send({ status: 'APPROVED', note: 'Looks right' })
      .expect(201);
    await client
      .agent('post', `${base()}/test-cases/${tc1}/status`)
      .send({ status: 'DEPRECATED' })
      .expect(403);
    await owner
      .agent('post', `${base()}/test-cases/${tc1}/status`)
      .send({ status: 'DRAFT' })
      .expect(400);
    const audit = await owner.agent('get', `/v1/orgs/${orgId}/audit?entityId=${tc1}`).expect(200);
    expect(audit.body.items[0]).toMatchObject({
      action: 'approve',
      metadata: { note: 'Looks right' },
    });
  });

  it('versions edits and sends edited approved cases back to review', async () => {
    const res = await qa
      .agent('patch', `${base()}/test-cases/${tc1}`)
      .send({
        steps: [{ action: 'Pay with declined card', expected: 'Error shown' }],
        changeNote: 'Simplified',
      })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'IN_REVIEW', version: 2 });
    // Metadata-only change bumps the version but keeps status.
    const meta = await qa
      .agent('patch', `${base()}/test-cases/${tc1}`)
      .send({ priority: 'CRITICAL' })
      .expect(200);
    expect(meta.body).toMatchObject({ status: 'IN_REVIEW', version: 3 });
    // No-op change: no new version.
    expect(
      (await qa.agent('patch', `${base()}/test-cases/${tc1}`).send({ priority: 'CRITICAL' })).body
        .version,
    ).toBe(3);
    const versions = await qa.agent('get', `${base()}/test-cases/${tc1}/versions`).expect(200);
    expect(versions.body.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(versions.body[1].snapshot).toMatchObject({
      changeNote: 'Simplified',
      steps: [{ action: 'Pay with declined card' }],
    });
    await qa.agent('patch', `${base()}/test-cases/${tc1}`).send({ requirementIds: [] }).expect(200);
    expect((await qa.agent('get', `${base()}/test-cases/${tc1}`)).body.requirements).toEqual([]);
    await qa
      .agent('post', `${base()}/requirements/${story()}/test-cases`)
      .send({ ids: [tc1, tc2] })
      .expect(201);
    await qa.agent('delete', `${base()}/requirements/${story()}/test-cases/${tc2}`).expect(204);
  });

  it('applies bulk actions and returns previous values for undo', async () => {
    const ids = [tc1, tc2];
    const res = await qa
      .agent('post', `${base()}/test-cases/bulk`)
      .send({ action: 'setPriority', ids, priority: 'LOW' })
      .expect(201);
    expect(res.body.previous.find((p: { id: string }) => p.id === tc1).priority).toBe('CRITICAL');
    await qa
      .agent('post', `${base()}/test-cases/bulk`)
      .send({ action: 'addTags', ids, tags: ['regression'] })
      .expect(201);
    await qa
      .agent('post', `${base()}/test-cases/bulk`)
      .send({ action: 'removeTags', ids, tags: ['smoke'] })
      .expect(201);
    await qa
      .agent('post', `${base()}/test-cases/bulk`)
      .send({ action: 'move', ids, suiteId: null })
      .expect(201);
    expect((await qa.agent('get', `${base()}/test-cases?suiteId=none`)).body.total).toBe(2);
    await qa
      .agent('post', `${base()}/test-cases/bulk`)
      .send({ action: 'setStatus', ids, status: 'APPROVED' })
      .expect(403);
    await client
      .agent('post', `${base()}/test-cases/bulk`)
      .send({ action: 'setPriority', ids, priority: 'HIGH' })
      .expect(403);
    await client
      .agent('post', `${base()}/test-cases/bulk`)
      .send({ action: 'setStatus', ids: [tc1], status: 'APPROVED' })
      .expect(201);
    await qa
      .agent('post', `${base()}/test-cases/bulk`)
      .send({ action: 'delete', ids: [tc2] })
      .expect(201);
    await qa.agent('get', `${base()}/test-cases/${tc2}`).expect(404);
    await qa
      .agent('post', `${base()}/test-cases/bulk`)
      .send({ action: 'restore', ids: [tc2] })
      .expect(201);
    await qa.agent('get', `${base()}/test-cases/${tc2}`).expect(200);
    await qa.agent('post', `${base()}/test-cases/bulk`).send({ action: 'nope', ids }).expect(400);
  });

  it('exports CSV and Excel with formula-injection protection', async () => {
    await qa
      .agent('post', `${base()}/test-cases`)
      .send({ title: '=HYPERLINK("http://evil")' })
      .expect(201);
    const csv = await qa
      .agent('get', `${base()}/test-cases/export?format=csv&sort=seq`)
      .expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const lines = csv.text.split('\r\n');
    expect(lines[0]).toContain('ID,Title,Suite');
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv.text).toContain('1. Pay with declined card');
    const xlsx = await qa
      .agent('get', `${base()}/test-cases/export?format=xlsx`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as never);
    expect(wb.worksheets[0]!.rowCount).toBe(4);
    expect(wb.worksheets[0]!.getCell('A2').value).toBe('TC-0001');
  });

  it('deleting a suite moves its cases to the parent', async () => {
    const t3 = (
      await qa
        .agent('post', `${base()}/test-cases`)
        .send({ title: 'In sub', suiteId: sub })
        .expect(201)
    ).body.id;
    await qa.agent('delete', `${base()}/suites/${sub}`).expect(204);
    expect((await qa.agent('get', `${base()}/test-cases/${t3}`)).body.suiteId).toBe(suite);
    const tree = await qa.agent('get', `${base()}/suites`).expect(200);
    expect(tree.body.suites).toHaveLength(1);
    expect(tree.body.suites[0].caseCount).toBe(1);
  });

  it('isolates tenants for test cases and suites', async () => {
    await outsider.agent('get', `${base()}/test-cases/${tc1}`).expect(404);
    await outsider
      .agent('post', `${base()}/test-cases/bulk`)
      .send({ action: 'delete', ids: [tc1] })
      .expect(404);
    const otherOrg = (await createOrg(outsider)).id;
    const otherProject = (
      await outsider
        .agent('post', `/v1/orgs/${otherOrg}/projects`)
        .send({ name: 'Other', key: 'OTH' })
        .expect(201)
    ).body.id;
    // Using another project's id in the path never reaches our data.
    await outsider.agent('get', `/v1/projects/${otherProject}/test-cases/${tc1}`).expect(404);
    await outsider
      .agent('patch', `/v1/projects/${otherProject}/test-cases/${tc1}`)
      .send({ title: 'pwn' })
      .expect(404);
    const bulk = await outsider
      .agent('post', `/v1/projects/${otherProject}/test-cases/bulk`)
      .send({ action: 'delete', ids: [tc1] });
    expect(bulk.status).toBe(404);
    await outsider
      .agent('post', `/v1/projects/${otherProject}/test-cases`)
      .send({ title: 'x', requirementIds: [story()] })
      .expect(400);
  });
});

describe('saved views & dashboard', () => {
  it('keeps personal views private and shared views visible', async () => {
    await qa
      .agent('post', `${base()}/views`)
      .send({ entity: 'test_case', name: 'My smoke', config: { tag: 'smoke' } })
      .expect(201);
    const shared = await qa
      .agent('post', `${base()}/views`)
      .send({
        entity: 'test_case',
        name: 'Team review',
        config: { status: ['IN_REVIEW'] },
        shared: true,
      })
      .expect(201);
    await client
      .agent('post', `${base()}/views`)
      .send({ entity: 'test_case', name: 'x', config: {}, shared: true })
      .expect(403);
    expect((await qa.agent('get', `${base()}/views?entity=test_case`)).body).toHaveLength(2);
    expect(
      (await client.agent('get', `${base()}/views?entity=test_case`)).body.map(
        (v: { name: string }) => v.name,
      ),
    ).toEqual(['Team review']);
    await client.agent('delete', `${base()}/views/${shared.body.id}`).expect(403);
    await owner.agent('delete', `${base()}/views/${shared.body.id}`).expect(204);
  });

  it('reports real coverage and attention items', async () => {
    const res = await client.agent('get', `${base()}/dashboard`).expect(200);
    expect(res.body.requirements).toMatchObject({
      total: 4,
      covered: 1,
      coveragePct: 25,
      highPriorityCoveragePct: 100,
    });
    expect(res.body.testCases.total).toBe(4);
    expect(res.body.testCases.byStatus.APPROVED).toBe(1);
    expect(res.body.lastRun).toBeNull();
    expect(res.body.openBugsBySeverity).toEqual({
      BLOCKER: 0,
      CRITICAL: 0,
      MAJOR: 0,
      MINOR: 0,
      TRIVIAL: 0,
    });
    expect(res.body.attention.toReview).toEqual([]);
  });
});
