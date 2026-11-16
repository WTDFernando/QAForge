/**
 * RBAC model. Roles are ordered by privilege; permissions are explicit so we
 * never rely on rank comparisons for security decisions except where noted.
 */
export const ROLES = [
  'OWNER',
  'ADMIN',
  'QA_LEAD',
  'QA_ENGINEER',
  'DEVELOPER',
  'VIEWER',
  'CLIENT',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  QA_LEAD: 'QA Lead',
  QA_ENGINEER: 'QA Engineer',
  DEVELOPER: 'Developer',
  VIEWER: 'Viewer',
  CLIENT: 'Client',
};

export const PERMISSIONS = [
  'org:read',
  'org:update',
  'org:delete',
  'org:billing',
  'members:read',
  'members:manage',
  'project:read',
  'project:create',
  'project:update',
  'project:delete',
  'requirement:read',
  'requirement:write',
  'testcase:read',
  'testcase:write',
  'testcase:approve',
  'run:read',
  'run:create',
  'run:execute',
  'bug:read',
  'bug:write',
  'comment:write',
  'release:read',
  'release:write',
  'release:approve',
  'release:sign',
  'ai:use',
  'ai:configure',
  'audit:read',
  'apitoken:manage',
  'webhook:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ_ALL: Permission[] = [
  'org:read',
  'members:read',
  'project:read',
  'requirement:read',
  'testcase:read',
  'run:read',
  'bug:read',
  'release:read',
];

const QA_ENGINEER: Permission[] = [
  ...READ_ALL,
  'requirement:write',
  'testcase:write',
  'run:create',
  'run:execute',
  'comment:write',
  'bug:write',
  'release:write',
  'ai:use',
];

const QA_LEAD: Permission[] = [
  ...QA_ENGINEER,
  'project:create',
  'project:update',
  'testcase:approve',
  'release:approve',
  'release:sign',
  'audit:read',
];

const ADMIN: Permission[] = [
  ...QA_LEAD,
  'org:update',
  'members:manage',
  'project:delete',
  'ai:configure',
  'apitoken:manage',
  'webhook:manage',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set<Permission>([...ADMIN, 'org:delete', 'org:billing']),
  ADMIN: new Set(ADMIN),
  QA_LEAD: new Set(QA_LEAD),
  QA_ENGINEER: new Set(QA_ENGINEER),
  DEVELOPER: new Set<Permission>([...READ_ALL, 'bug:write', 'run:execute', 'comment:write']),
  VIEWER: new Set(READ_ALL),
  // Client: read-only plus approval of test cases and releases.
  CLIENT: new Set<Permission>([
    ...READ_ALL,
    'testcase:approve',
    'release:approve',
    'comment:write',
  ]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Can `actor` assign `target` role to someone? Only to roles at or below their own (Owner only by Owner). */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (!hasPermission(actor, 'members:manage')) return false;
  if (target === 'OWNER') return actor === 'OWNER';
  return ROLES.indexOf(target) >= ROLES.indexOf(actor);
}
