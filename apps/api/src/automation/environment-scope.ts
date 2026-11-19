import { NotFoundException } from '@nestjs/common';
import { decryptJson, type Prisma } from '@qaforge/db';

/**
 * Variables and secrets an automation run sees for an environment. Secrets stay in memory: they
 * are redacted from every stored exchange, log and AI prompt.
 */
export async function environmentScope(
  db: Prisma.TransactionClient,
  projectId: string,
  environmentId: string | null | undefined,
) {
  if (!environmentId)
    return {
      baseUrl: null as string | null,
      env: {} as Record<string, string>,
      secrets: {} as Record<string, string>,
    };
  const e = await db.environment.findFirst({ where: { id: environmentId, projectId } });
  if (!e) throw new NotFoundException('Environment not found');
  const vars = (e.variables ?? {}) as Record<string, string>;
  return {
    baseUrl: e.baseUrl,
    env: { ...(e.baseUrl ? { BASE_URL: e.baseUrl } : {}), ...vars },
    secrets: e.secrets ? decryptJson<Record<string, string>>(e.secrets) : {},
  };
}
