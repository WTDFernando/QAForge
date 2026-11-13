import type { AuthedRequest } from '../auth/principal';
import type { Actor } from '../audit/audit.service';

/** Context for project-scoped handlers; guaranteed by PermissionGuard on :projectId routes. */
export interface ProjectCtx {
  projectId: string;
  organizationId: string;
  actor: Actor & { id: string };
  role: NonNullable<AuthedRequest['membership']>['role'];
}

export function projectCtx(req: AuthedRequest): ProjectCtx {
  const m = req.membership!;
  return {
    projectId: m.projectId!,
    organizationId: m.organizationId,
    actor: { type: 'USER', id: req.principal!.userId },
    role: m.role,
  };
}

export { nextSeq } from '@qaforge/db';
