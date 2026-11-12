import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../bootstrap';

let counter = 0;

export async function bootTestApp(): Promise<INestApplication> {
  const app = await createApp({ logger: false });
  await app.init();
  return app;
}

export interface TestUser {
  email: string;
  cookie: string[];
  agent: (method: 'get' | 'post' | 'patch' | 'delete', url: string) => request.Test;
}

/** Sign up a fresh user through Better Auth and return an authenticated request helper. */
export async function signUp(app: INestApplication, name = 'Test User'): Promise<TestUser> {
  const email = `user${Date.now()}${counter++}@test.dev`;
  const res = await request(app.getHttpServer())
    .post('/api/auth/sign-up/email')
    .set('Origin', 'http://localhost:3000')
    .send({ name, email, password: 'correct-horse-battery' })
    .expect(200);
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  return {
    email,
    cookie,
    agent: (method, url) =>
      request(app.getHttpServer())
        [method](url)
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:3000'),
  };
}

export async function createOrg(user: TestUser, slug = `org-${Date.now()}-${counter++}`) {
  const res = await user.agent('post', '/v1/orgs').send({ name: 'Test Org', slug }).expect(201);
  return res.body as { id: string; slug: string };
}

/** Invite + accept, returning the new member's membership id. */
export async function addMember(owner: TestUser, orgId: string, member: TestUser, role: string) {
  const inv = await owner
    .agent('post', `/v1/orgs/${orgId}/invitations`)
    .send({ email: member.email, role })
    .expect(201);
  await member.agent('post', `/v1/invitations/${inv.body.id}/accept`).expect(201);
  const members = await owner.agent('get', `/v1/orgs/${orgId}/members`).expect(200);
  return (members.body as Array<{ id: string; user: { email: string } }>).find(
    (m) => m.user.email === member.email,
  )!.id;
}
