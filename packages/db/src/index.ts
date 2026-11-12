import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';
export { diffChanges } from './audit';
export type { FieldChanges } from './audit';

const globalForPrisma = globalThis as unknown as { __qaforgePrisma?: PrismaClient };

/** Process-wide Prisma client (reused across hot reloads in dev). */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__qaforgePrisma) {
    globalForPrisma.__qaforgePrisma = new PrismaClient({
      log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn'] : ['warn'],
    });
  }
  return globalForPrisma.__qaforgePrisma;
}
