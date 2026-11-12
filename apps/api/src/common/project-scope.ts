import type { Prisma } from '@qaforge/db';
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

/** Atomically allocate the next per-project sequence number (REQ-0001, TC-0001...). */
export async function nextSeq(
  tx: Prisma.TransactionClient,
  projectId: string,
  kind: string,
  count = 1,
): Promise<number> {
  const row = await tx.projectCounter.upsert({
    where: { projectId_kind: { projectId, kind } },
    create: { projectId, kind, value: count },
    update: { value: { increment: count } },
  });
  return row.value - count + 1;
}
