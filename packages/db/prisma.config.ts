import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma skips .env loading when a config file exists; load the monorepo root .env if present.
try {
  process.loadEnvFile(path.resolve(__dirname, '../../.env'));
} catch {
  /* env provided by the shell/CI */
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: { seed: 'tsx prisma/seed.ts' },
});
