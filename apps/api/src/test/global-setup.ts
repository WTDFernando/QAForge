import { execSync } from 'node:child_process';
import path from 'node:path';

/** Apply migrations to the test database and wipe data before the suite. */
export default async function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/qaforge_test';
  const dbDir = path.resolve(__dirname, '../../../../packages/db');
  const run = (cmd: string) =>
    execSync(cmd, { cwd: dbDir, stdio: 'pipe', env: { ...process.env, DATABASE_URL: url } });
  // Create the database if needed (Prisma's migrate deploy creates it when missing).
  run('npx prisma migrate deploy');
  const { PrismaClient } = await import('@qaforge/db');
  const prisma = new PrismaClient({ datasourceUrl: url });
  await prisma.$executeRawUnsafe(
    'TRUNCATE "audit_log","project_counter","project","invitation","membership","organization","verification","account","session","user" CASCADE',
  );
  await prisma.$disconnect();
}
