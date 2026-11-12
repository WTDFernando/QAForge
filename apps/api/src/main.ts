import { getPrisma } from '@qaforge/db';
import { createApp } from './bootstrap';
import { env } from './config/env';

/** Fail fast with a readable message instead of returning 500s on every request. */
async function checkDatabase() {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
  } catch (e) {
    const url = env().DATABASE_URL.replace(/:[^:@/]+@/, ':****@');
    console.error(
      [
        '',
        '✖ QAForge API cannot connect to PostgreSQL.',
        `  DATABASE_URL = ${url}`,
        `  Reason: ${(e as Error).message.split('\n').filter(Boolean).pop()}`,
        '  Fix: start the database with "docker compose up -d" (Docker Desktop must be running),',
        '       make sure nothing else uses port 5432, then run "pnpm db:deploy" and "pnpm db:seed".',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
}

async function main() {
  await checkDatabase();
  const app = await createApp();
  await app.listen(env().API_PORT);
}

void main();
