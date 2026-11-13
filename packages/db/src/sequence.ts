import type { Prisma } from '@prisma/client';

/** Atomically allocate the next per-project sequence number(s) (REQ-0001, TC-0001...). Returns the first. */
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
