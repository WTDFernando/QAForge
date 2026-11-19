import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { nextSeq } from './sequence';

/** Create an automation run row (AUT-0001). Callers enqueue it after the transaction commits. */
export async function insertAutomationRun(
  tx: Prisma.TransactionClient,
  data: Omit<Prisma.AutomationRunUncheckedCreateInput, 'seq' | 'id'>,
) {
  const seq = await nextSeq(tx, data.projectId, 'automationRun');
  return tx.automationRun.create({ data: { ...data, seq } });
}

/** CI tokens: shown once, stored as a SHA-256 hash. */
export function generateProjectToken() {
  const token = `qaf_ci_${randomBytes(30).toString('base64url')}`;
  return { token, prefix: token.slice(0, 12), hash: hashToken(token) };
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
