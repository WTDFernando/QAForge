import type { INestApplication } from '@nestjs/common';
import express from 'express';
import IORedis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, signFileToken } from '@qaforge/db';
import { defaultRules, rateLimit } from './common/rate-limit';
import { addMember, bootTestApp, createOrg, signUp, type TestUser } from './test/helpers';

let app: INestApplication;
let lead: TestUser;
let qa: TestUser;
let outsider: TestUser;
let pid: string;
const base = () => `/v1/projects/${pid}`;
const prisma = getPrisma();
const png = Buffer.from('89504e470d0a1a0a', 'hex');
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await bootTestApp();
  lead = await signUp(app, 'Sec Lead');
  const orgId = (await createOrg(lead)).id;
  qa = await signUp(app, 'Sec QA');
  outsider = await signUp(app, 'Sec Outsider');
  await addMember(lead, orgId, qa, 'QA_ENGINEER');
  pid = (
    await lead
      .agent('post', `/v1/orgs/${orgId}/projects`)
      .send({ name: 'Sec', key: 'SEC' })
      .expect(201)
  ).body.id;
});
afterAll(async () => {
  await app.close();
});

describe('signed file URLs', () => {
  it('issues short-lived URLs that work without a session and reject tampering', async () => {
    const shot = (
      await qa
        .agent('post', `${base()}/bugs/uploads`)
        .attach('file', png, { filename: 'shot.png', contentType: 'image/png' })
        .expect(201)
    ).body;
    // Without a scanner configured, uploads are usable and marked "not scanned"; the hash is stored.
    expect(shot.scanStatus).toBe('SKIPPED');
    expect(shot.sha256).toMatch(/^[0-9a-f]{64}$/);

    const signed = (await qa.agent('get', `${base()}/attachments/${shot.id}/url`).expect(200)).body;
    const ttl = (new Date(signed.expiresAt).getTime() - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(200);
    expect(ttl).toBeLessThanOrEqual(300);
    const ok = await http().get(signed.url).expect(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.headers['content-disposition']).toMatch(/^inline/);
    expect(ok.headers['content-security-policy']).toContain('sandbox');

    const forced = (
      await qa.agent('get', `${base()}/attachments/${shot.id}/url?download=1`).expect(200)
    ).body;
    expect((await http().get(forced.url).expect(200)).headers['content-disposition']).toMatch(
      /^attachment/,
    );

    const u = new URL(signed.url, 'http://x');
    const tampered = `${u.pathname}?exp=${Number(u.searchParams.get('exp')) + 60}&disp=inline&sig=${u.searchParams.get('sig')}`;
    await http().get(tampered).expect(404);
    await http().get(signed.url.replace('disp=inline', 'disp=attachment')).expect(404);
    await http().get(`${u.pathname}?exp=1&disp=inline&sig=x`).expect(404);
    await http().get(`${u.pathname}?exp=1&disp=evil&sig=x`).expect(400);
    const expired = Math.floor(Date.now() / 1000) - 1;
    await http()
      .get(
        `${u.pathname}?exp=${expired}&disp=inline&sig=${signFileToken(shot.id, expired, 'inline')}`,
      )
      .expect(404);
  });

  it('keeps unattached uploads private to the uploader and project members only', async () => {
    const shot = (
      await qa
        .agent('post', `${base()}/bugs/uploads`)
        .attach('file', png, { filename: 'mine.png', contentType: 'image/png' })
        .expect(201)
    ).body;
    await lead.agent('get', `${base()}/attachments/${shot.id}/url`).expect(404);
    await outsider.agent('get', `${base()}/attachments/${shot.id}/url`).expect(404);
    await qa.agent('get', `${base()}/attachments/${shot.id}/url`).expect(200);
  });

  it('blocks files until the malware scan is clean', async () => {
    const shot = (
      await qa
        .agent('post', `${base()}/bugs/uploads`)
        .attach('file', png, { filename: 'scan.png', contentType: 'image/png' })
        .expect(201)
    ).body;
    const signed = (await qa.agent('get', `${base()}/attachments/${shot.id}/url`).expect(200)).body;
    for (const [status, msg] of [
      ['PENDING', /still being scanned/],
      ['INFECTED', /failed the malware scan/],
      ['FAILED', /could not be scanned/],
    ] as const) {
      await prisma.attachment.update({ where: { id: shot.id }, data: { scanStatus: status } });
      const res = await qa.agent('get', `${base()}/attachments/${shot.id}/url`).expect(409);
      expect(res.body.message).toMatch(msg);
      // Links issued earlier stop working too.
      await http().get(signed.url).expect(409);
    }
    await prisma.attachment.update({ where: { id: shot.id }, data: { scanStatus: 'CLEAN' } });
    await http().get(signed.url).expect(200);
    // Agents refuse infected screenshots up front.
    await prisma.attachment.update({ where: { id: shot.id }, data: { scanStatus: 'INFECTED' } });
    await qa
      .agent('post', `${base()}/agent-jobs`)
      .send({ kind: 'draft-bug', note: 'Infected shot', attachmentId: shot.id })
      .expect(400);
  });
});

describe('rate limiting', () => {
  const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  afterAll(() => redis.disconnect());

  function limited(limits = { api: 5, auth: 2, ai: 3 }, now = () => Date.now()) {
    const ex = express();
    ex.set('trust proxy', 1);
    ex.use(rateLimit(redis, defaultRules(limits), now));
    ex.all(/.*/, (_req, res) => {
      res.json({ ok: true });
    });
    return ex;
  }
  const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;

  it('limits sign-in attempts per IP and tells the client when to retry', async () => {
    const ex = limited();
    const from = ip();
    for (let i = 0; i < 2; i++)
      await request(ex).post('/api/auth/sign-in/email').set('X-Forwarded-For', from).expect(200);
    const blocked = await request(ex)
      .post('/api/auth/sign-in/email')
      .set('X-Forwarded-For', from)
      .expect(429);
    expect(blocked.body.message).toMatch(/Too many attempts/);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['ratelimit-remaining']).toBe('0');
    // Another address is unaffected; reading the session is not an "auth attempt".
    await request(ex).post('/api/auth/sign-in/email').set('X-Forwarded-For', ip()).expect(200);
    await request(ex).get('/api/auth/get-session').set('X-Forwarded-For', from).expect(200);
  });

  it('limits AI calls per user, separately from the general API budget', async () => {
    const ex = limited();
    const cookie = `better-auth.session_token=tok-${Math.random()}`;
    const other = `better-auth.session_token=tok-${Math.random()}`;
    for (let i = 0; i < 3; i++)
      await request(ex).post('/v1/projects/p1/agent-jobs').set('Cookie', cookie).expect(200);
    await request(ex).post('/v1/projects/p1/copilot').set('Cookie', cookie).expect(429);
    await request(ex).post('/v1/projects/p1/copilot').set('Cookie', other).expect(200);
    // Same user, ordinary reads still work (4 of 5 general requests used).
    const ok = await request(ex).get('/v1/projects/p1/bugs').set('Cookie', cookie).expect(200);
    expect(ok.headers['ratelimit-limit']).toBe('5');
    await request(ex).get('/v1/projects/p1/bugs').set('Cookie', cookie).expect(429);
  });

  it('resets every window and fails open when Redis is down', async () => {
    let t = Date.UTC(2026, 10, 16, 12, 0, 1);
    const ex = limited({ api: 1, auth: 1, ai: 1 }, () => t);
    const cookie = `better-auth.session_token=tok-${Math.random()}`;
    await request(ex).get('/v1/me').set('Cookie', cookie).expect(200);
    await request(ex).get('/v1/me').set('Cookie', cookie).expect(429);
    t += 60_000;
    await request(ex).get('/v1/me').set('Cookie', cookie).expect(200);
    // Health checks and static paths are never limited.
    await request(ex).get('/health').set('Cookie', cookie).expect(200);

    const dead = new IORedis({
      port: 1,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    dead.on('error', () => undefined);
    const ex2 = express();
    ex2.use(rateLimit(dead, defaultRules({ api: 1, auth: 1, ai: 1 })));
    ex2.get(/.*/, (_req, res) => {
      res.json({ ok: true });
    });
    await request(ex2).get('/v1/me').expect(200);
    await request(ex2).get('/v1/me').expect(200);
    dead.disconnect();
  });
});
