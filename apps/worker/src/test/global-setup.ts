import { execSync } from 'node:child_process';
import path from 'node:path';

export default async function setup() {
  const url =
    process.env.TEST_WORKER_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/qaforge_test_worker';
  const dbDir = path.resolve(__dirname, '../../../../packages/db');
  execSync('npx prisma migrate deploy', {
    cwd: dbDir,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
  const { PrismaClient } = await import('@qaforge/db');
  const prisma = new PrismaClient({ datasourceUrl: url });
  const tables = await prisma.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(',')} CASCADE`,
  );
  await prisma.$disconnect();
}
