import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, bootTestApp, createOrg, signUp, type TestUser } from './test/helpers';

let app: INestApplication;
beforeAll(async () => {
  app = await bootTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('health & auth', () => {
  it('health is public', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.db).toBe('up');
  });
  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer()).get('/v1/me').expect(401);
  });
  it('returns the current user with orgs', async () => {
    const u = await signUp(app, 'Alice');
    await createOrg(u);
    const res = await u.agent('get', '/v1/me').expect(200);
    expect(res.body.user.name).toBe('Alice');
    expect(res.body.organizations[0].role).toBe('OWNER');
  });
  it('lists auth providers publicly', async () => {
    const res = await request(app.getHttpServer()).get('/v1/auth/providers').expect(200);
    expect(res.body).toEqual({ emailPassword: true, social: [] });
  });
  it('serves OpenAPI', async () => {
    const res = await request(app.getHttpServer()).get('/openapi.json').expect(200);
    expect(res.body.paths['/v1/orgs/{orgId}/projects']).toBeDefined();
  });
});

describe('organizations', () => {
  let owner: TestUser;
  let orgId: string;
  beforeAll(async () => {
    owner = await signUp(app, 'Owner');
    orgId = (await createOrg(owner)).id;
  });

  it('lists and fetches orgs', async () => {
    const list = await owner.agent('get', '/v1/orgs').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ role: 'OWNER', memberCount: 1, projectCount: 0 });
    const one = await owner.agent('get', `/v1/orgs/${orgId}`).expect(200);
    expect(one.body.role).toBe('OWNER');
  });

  it('rejects duplicate slugs with 409', async () => {
    const { slug } = await owner.agent('get', `/v1/orgs/${orgId}`).then((r) => r.body);
    await owner.agent('post', '/v1/orgs').send({ name: 'Dup', slug }).expect(409);
  });

  it('validates input', async () => {
    const res = await owner
      .agent('post', '/v1/orgs')
      .send({ name: 'X', slug: 'Bad Slug' })
      .expect(400);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('updates and audits', async () => {
    await owner.agent('patch', `/v1/orgs/${orgId}`).send({ name: 'Renamed Org' }).expect(200);
    const audit = await owner
      .agent('get', `/v1/orgs/${orgId}/audit?entityType=organization`)
      .expect(200);
    expect(audit.body.items[0]).toMatchObject({
      action: 'update',
      changes: { name: { from: 'Test Org', to: 'Renamed Org' } },
    });
  });

  it('isolates tenants: outsiders get 404', async () => {
    const outsider = await signUp(app, 'Mallory');
    await outsider.agent('get', `/v1/orgs/${orgId}`).expect(404);
    await outsider.agent('get', `/v1/orgs/${orgId}/projects`).expect(404);
    await outsider.agent('get', '/v1/orgs/not-a-uuid').expect(404);
  });
});

describe('members & invitations', () => {
  let owner: TestUser;
  let orgId: string;
  beforeAll(async () => {
    owner = await signUp(app, 'Owner2');
    orgId = (await createOrg(owner)).id;
  });

  it('invites, accepts and enforces role on the new member', async () => {
    const viewer = await signUp(app, 'Vic Viewer');
    await addMember(owner, orgId, viewer, 'VIEWER');
    await viewer.agent('get', `/v1/orgs/${orgId}/projects`).expect(200);
    await viewer
      .agent('post', `/v1/orgs/${orgId}/projects`)
      .send({ name: 'Nope', key: 'NOPE' })
      .expect(403);
    await viewer.agent('get', `/v1/orgs/${orgId}/invitations`).expect(403);
  });

  it('shows pending invitations on /me and supports revoke', async () => {
    const invitee = await signUp(app, 'Ivy');
    const inv = await owner
      .agent('post', `/v1/orgs/${orgId}/invitations`)
      .send({ email: invitee.email, role: 'QA_ENGINEER' })
      .expect(201);
    const me = await invitee.agent('get', '/v1/me').expect(200);
    expect(me.body.pendingInvitations).toHaveLength(1);
    const pending = await owner.agent('get', `/v1/orgs/${orgId}/invitations`).expect(200);
    expect(pending.body.some((i: { id: string }) => i.id === inv.body.id)).toBe(true);
    await owner.agent('delete', `/v1/orgs/${orgId}/invitations/${inv.body.id}`).expect(204);
    await invitee.agent('post', `/v1/invitations/${inv.body.id}/accept`).expect(400);
  });

  it('only the addressee can accept', async () => {
    const a = await signUp(app, 'A');
    const b = await signUp(app, 'B');
    const inv = await owner
      .agent('post', `/v1/orgs/${orgId}/invitations`)
      .send({ email: a.email, role: 'VIEWER' })
      .expect(201);
    await b.agent('post', `/v1/invitations/${inv.body.id}/accept`).expect(404);
  });

  it('rejects inviting existing members', async () => {
    const m = await signUp(app, 'M');
    await addMember(owner, orgId, m, 'DEVELOPER');
    await owner
      .agent('post', `/v1/orgs/${orgId}/invitations`)
      .send({ email: m.email, role: 'VIEWER' })
      .expect(400);
  });

  it('admins cannot create owners; role changes are audited', async () => {
    const admin = await signUp(app, 'Ada Admin');
    await addMember(owner, orgId, admin, 'ADMIN');
    const dev = await signUp(app, 'Dev');
    const devMemberId = await addMember(owner, orgId, dev, 'DEVELOPER');
    await admin
      .agent('patch', `/v1/orgs/${orgId}/members/${devMemberId}`)
      .send({ role: 'OWNER' })
      .expect(403);
    await admin
      .agent('post', `/v1/orgs/${orgId}/invitations`)
      .send({ email: 'x@test.dev', role: 'OWNER' })
      .expect(403);
    await admin
      .agent('patch', `/v1/orgs/${orgId}/members/${devMemberId}`)
      .send({ role: 'QA_ENGINEER' })
      .expect(200);
    const audit = await owner
      .agent('get', `/v1/orgs/${orgId}/audit?entityId=${devMemberId}`)
      .expect(200);
    expect(audit.body.items[0].changes.role).toEqual({ from: 'DEVELOPER', to: 'QA_ENGINEER' });
    await owner
      .agent('patch', `/v1/orgs/${orgId}/members/00000000-0000-4000-8000-000000000000`)
      .send({ role: 'VIEWER' })
      .expect(404);
  });

  it('keeps at least one owner', async () => {
    const members = await owner.agent('get', `/v1/orgs/${orgId}/members`).expect(200);
    const ownerMember = members.body.find((m: { role: string }) => m.role === 'OWNER');
    await owner
      .agent('patch', `/v1/orgs/${orgId}/members/${ownerMember.id}`)
      .send({ role: 'ADMIN' })
      .expect(400);
    await owner.agent('delete', `/v1/orgs/${orgId}/members/${ownerMember.id}`).expect(400);
  });

  it('members can leave; others cannot remove higher roles', async () => {
    const leaver = await signUp(app, 'Leaver');
    const leaverId = await addMember(owner, orgId, leaver, 'VIEWER');
    const peer = await signUp(app, 'Peer');
    const peerId = await addMember(owner, orgId, peer, 'VIEWER');
    await leaver.agent('delete', `/v1/orgs/${orgId}/members/${peerId}`).expect(403);
    await leaver.agent('delete', `/v1/orgs/${orgId}/members/${leaverId}`).expect(204);
    await leaver.agent('get', `/v1/orgs/${orgId}`).expect(404);
    await owner.agent('delete', `/v1/orgs/${orgId}/members/${leaverId}`).expect(404);
  });
});

describe('projects', () => {
  let lead: TestUser;
  let owner: TestUser;
  let orgId: string;
  let projectId: string;
  beforeAll(async () => {
    owner = await signUp(app, 'Owner3');
    orgId = (await createOrg(owner)).id;
    lead = await signUp(app, 'Lead');
    await addMember(owner, orgId, lead, 'QA_LEAD');
  });

  it('creates, lists and fetches projects', async () => {
    const res = await lead
      .agent('post', `/v1/orgs/${orgId}/projects`)
      .send({ name: 'Payments', key: 'PAY' })
      .expect(201);
    projectId = res.body.id;
    const list = await lead.agent('get', `/v1/orgs/${orgId}/projects`).expect(200);
    expect(list.body.map((p: { key: string }) => p.key)).toEqual(['PAY']);
    await lead.agent('get', `/v1/projects/${projectId}`).expect(200);
  });

  it('enforces unique keys per org', async () => {
    await lead
      .agent('post', `/v1/orgs/${orgId}/projects`)
      .send({ name: 'Other', key: 'PAY' })
      .expect(409);
    await lead.agent('patch', `/v1/projects/${projectId}`).send({ key: 'PAY' }).expect(200);
  });

  it('archives and restores with audit trail', async () => {
    await lead.agent('patch', `/v1/projects/${projectId}`).send({ archived: true }).expect(200);
    expect((await lead.agent('get', `/v1/orgs/${orgId}/projects`)).body).toHaveLength(0);
    expect(
      (await lead.agent('get', `/v1/orgs/${orgId}/projects?includeArchived=true`)).body,
    ).toHaveLength(1);
    await lead
      .agent('patch', `/v1/projects/${projectId}`)
      .send({ archived: false, description: 'Checkout' })
      .expect(200);
    const audit = await lead
      .agent('get', `/v1/orgs/${orgId}/audit?projectId=${projectId}&limit=2`)
      .expect(200);
    expect(audit.body.items.map((i: { action: string }) => i.action)).toEqual([
      'restore',
      'archive',
    ]);
    const page2 = await lead
      .agent(
        'get',
        `/v1/orgs/${orgId}/audit?projectId=${projectId}&limit=2&cursor=${audit.body.nextCursor}`,
      )
      .expect(200);
    expect(page2.body.items.map((i: { action: string }) => i.action)).toEqual(['create']);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('hides projects from other tenants', async () => {
    const outsider = await signUp(app, 'Outsider');
    await outsider.agent('get', `/v1/projects/${projectId}`).expect(404);
    await outsider.agent('get', '/v1/projects/00000000-0000-4000-8000-000000000000').expect(404);
    await outsider.agent('patch', `/v1/projects/${projectId}`).send({ name: 'pwn' }).expect(404);
  });
});
