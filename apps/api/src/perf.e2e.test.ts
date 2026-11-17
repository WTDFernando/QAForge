import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPerfFixture, getPrisma } from '@qaforge/db';
import { bootTestApp, createOrg, signUp, type TestUser } from './test/helpers';

/**
 * NFR: a 10,000 test case list loads in under 1 s. The API share of that budget is checked here
 * (well under 1 s even on a CI runner); the browser side is checked by e2e/perf.spec.ts.
 */
const BUDGET_MS = 500;
let app: INestApplication;
let owner: TestUser;
let pid: string;

beforeAll(async () => {
  app = await bootTestApp();
  owner = await signUp(app, 'Perf Owner');
  const orgId = (await createOrg(owner)).id;
  const me = (await owner.agent('get', '/v1/me')).body.user.id as string;
  pid = (await createPerfFixture(getPrisma(), { organizationId: orgId, userId: me, key: 'PRF' }))
    .projectId;
}, 120_000);
afterAll(async () => {
  await app.close();
});

async function timed(qs: string) {
  const url = `/v1/projects/${pid}/test-cases?${qs}`;
  await owner.agent('get', url).expect(200); // warm-up (connection pool, query plans)
  const samples: number[] = [];
  let body: { total: number; items: unknown[] } = { total: 0, items: [] };
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    body = (await owner.agent('get', url).expect(200)).body;
    samples.push(performance.now() - t0);
  }
  return { ms: Math.min(...samples), body };
}

describe('10,000 test cases', () => {
  it.each([
    ['first page', ''],
    ['last page', 'page=200'],
    ['sorted by title', 'sort=title&dir=asc&page=100'],
    ['recently updated', 'sort=updatedAt&dir=desc'],
    ['filtered', 'status=APPROVED&priority=HIGH,CRITICAL'],
    ['searched', 'q=refund'],
    ['by tag', 'tag=regression'],
    ['500 rows', 'pageSize=500'],
    ['suite subtree', 'deep=true'],
  ])('%s responds within budget', async (_name, qs) => {
    const { ms, body } = await timed(qs);
    expect(body.total).toBeGreaterThan(0);
    expect(ms, `${qs || 'default'} took ${ms.toFixed(0)} ms`).toBeLessThan(BUDGET_MS);
  });

  it('counts the whole project', async () => {
    const { body } = await timed('pageSize=1');
    expect(body.total).toBe(10_000);
  });
});
