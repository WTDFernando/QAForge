import { describe, expect, it } from 'vitest';
import {
  bugQuerySchema,
  canMoveBug,
  createBugSchema,
  createTestRunSchema,
  passRate,
  recordResultSchema,
  setBugStatusSchema,
  updateBugSchema,
} from './index';

describe('runs', () => {
  it('validates run creation by selection kind', () => {
    const r = createTestRunSchema.parse({
      name: 'Sprint 12',
      selection: { kind: 'suite', suiteId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(r).toMatchObject({ onlyApproved: false, selection: { deep: true } });
    expect(
      createTestRunSchema.safeParse({ name: 'x', selection: { kind: 'cases', testCaseIds: [] } })
        .success,
    ).toBe(false);
    expect(recordResultSchema.safeParse({ status: 'NOPE' }).success).toBe(false);
  });
  it('computes pass rate over executed results', () => {
    expect(passRate({})).toBeNull();
    expect(passRate({ PASSED: 3, FAILED: 1, SKIPPED: 5 })).toBe(75);
    expect(passRate({ PASSED: 2, FAILED: 1 })).toBe(66.7);
  });
});

describe('bugs', () => {
  it('enforces the workflow', () => {
    expect(canMoveBug('NEW', 'TRIAGED')).toBe(true);
    expect(canMoveBug('NEW', 'READY_FOR_RETEST')).toBe(false);
    expect(canMoveBug('CLOSED', 'REOPENED')).toBe(true);
    expect(canMoveBug('CLOSED', 'FIXED')).toBe(false);
  });
  it('requires a resolution to close and a target for duplicates', () => {
    expect(setBugStatusSchema.safeParse({ status: 'CLOSED' }).success).toBe(false);
    expect(
      setBugStatusSchema.safeParse({ status: 'CLOSED', resolution: 'DUPLICATE' }).success,
    ).toBe(false);
    expect(setBugStatusSchema.safeParse({ status: 'CLOSED', resolution: 'FIXED' }).success).toBe(
      true,
    );
  });
  it('applies defaults on create but not on patch', () => {
    expect(createBugSchema.parse({ title: 'Crash' })).toMatchObject({
      severity: 'MAJOR',
      priority: 'MEDIUM',
      envDetails: {},
    });
    expect(updateBugSchema.parse({ title: 'x' })).toEqual({ title: 'x' });
  });
  it('parses list queries', () => {
    expect(
      bugQuerySchema.parse({ status: 'NEW,TRIAGED', assigneeId: 'me', openOnly: 'true' }),
    ).toMatchObject({
      status: ['NEW', 'TRIAGED'],
      assigneeId: 'me',
      openOnly: true,
      sort: 'seq',
      dir: 'desc',
    });
  });
});
