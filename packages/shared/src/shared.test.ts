import { describe, expect, it } from 'vitest';
import {
  canAssignRole,
  createOrganizationSchema,
  createProjectSchema,
  formatRef,
  hasPermission,
  isRole,
  parseRef,
  ROLE_PERMISSIONS,
  ROLES,
} from './index';

describe('RBAC', () => {
  it('owner has every permission any other role has', () => {
    for (const role of ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(hasPermission('OWNER', p)).toBe(true);
    }
  });
  it('client is read-only plus approvals', () => {
    expect(hasPermission('CLIENT', 'testcase:read')).toBe(true);
    expect(hasPermission('CLIENT', 'release:approve')).toBe(true);
    expect(hasPermission('CLIENT', 'testcase:write')).toBe(false);
    expect(hasPermission('CLIENT', 'bug:write')).toBe(false);
  });
  it('viewer cannot write', () => {
    for (const p of ROLE_PERMISSIONS.VIEWER) expect(p.endsWith(':read')).toBe(true);
  });
  it('developers execute runs and comment but do not create runs', () => {
    expect(hasPermission('DEVELOPER', 'run:execute')).toBe(true);
    expect(hasPermission('DEVELOPER', 'comment:write')).toBe(true);
    expect(hasPermission('DEVELOPER', 'run:create')).toBe(false);
    expect(hasPermission('QA_ENGINEER', 'run:create')).toBe(true);
  });
  it('developer can log bugs but not approve test cases', () => {
    expect(hasPermission('DEVELOPER', 'bug:write')).toBe(true);
    expect(hasPermission('DEVELOPER', 'testcase:approve')).toBe(false);
  });
  it('role assignment respects hierarchy', () => {
    expect(canAssignRole('OWNER', 'OWNER')).toBe(true);
    expect(canAssignRole('ADMIN', 'OWNER')).toBe(false);
    expect(canAssignRole('ADMIN', 'ADMIN')).toBe(true);
    expect(canAssignRole('ADMIN', 'VIEWER')).toBe(true);
    expect(canAssignRole('QA_LEAD', 'VIEWER')).toBe(false);
  });
  it('isRole guards strings', () => {
    expect(isRole('QA_LEAD')).toBe(true);
    expect(isRole('ROOT')).toBe(false);
    expect(isRole(3)).toBe(false);
  });
});

describe('schemas', () => {
  it('validates project keys', () => {
    expect(createProjectSchema.safeParse({ name: 'Payments', key: 'PAY' }).success).toBe(true);
    expect(createProjectSchema.safeParse({ name: 'Payments', key: 'pay' }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: 'P', key: 'PAY' }).success).toBe(false);
  });
});

describe('slugs', () => {
  it('rejects reserved and malformed slugs', () => {
    expect(createOrganizationSchema.safeParse({ name: 'Acme', slug: 'acme' }).success).toBe(true);
    expect(createOrganizationSchema.safeParse({ name: 'Acme', slug: 'login' }).success).toBe(false);
    expect(createOrganizationSchema.safeParse({ name: 'Acme', slug: '-acme' }).success).toBe(false);
  });
});

describe('refs', () => {
  it('round-trips', () => {
    const ref = formatRef('testCase', 142);
    expect(ref).toBe('TC-0142');
    expect(parseRef(ref)).toEqual({ kind: 'testCase', seq: 142 });
    expect(parseRef(' tc-7 ')).toEqual({ kind: 'testCase', seq: 7 });
    expect(formatRef('requirement', 12345)).toBe('REQ-12345');
  });
  it('rejects junk', () => {
    expect(parseRef('XX-1')).toBeNull();
    expect(parseRef('TC-0')).toBeNull();
    expect(parseRef('nope')).toBeNull();
  });
});
