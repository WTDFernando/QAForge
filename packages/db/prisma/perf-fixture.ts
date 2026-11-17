/* Adds a "PERF" project with 10,000 test cases to the demo org: pnpm db:perf-fixture */
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createPerfFixture } from '../src/perf-fixture';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
  } catch {
    /* Prisma reports the missing variable */
  }
}
const prisma = new PrismaClient();
async function main() {
  const org = await prisma.organization.findUniqueOrThrow({ where: { slug: 'acme' } });
  const owner = await prisma.membership.findFirstOrThrow({
    where: { organizationId: org.id, role: 'OWNER' },
  });
  const t0 = Date.now();
  const r = await createPerfFixture(prisma, {
    organizationId: org.id,
    userId: owner.userId,
    count: Number(process.env.PERF_COUNT ?? 10000),
  });
  console.log(
    r.created
      ? `Created PERF project in ${((Date.now() - t0) / 1000).toFixed(1)}s`
      : 'PERF project already exists',
  );
}
main().finally(() => prisma.$disconnect());
