import { defineConfig } from 'vitest/config';

const TEST_DB = 'postgresql://postgres:postgres@localhost:5432/qaforge_test_worker';

export default defineConfig({
  test: {
    globalSetup: ['src/test/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_WORKER_DATABASE_URL ?? TEST_DB,
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
      QAFORGE_AI_PROVIDER: 'fake',
      ANTHROPIC_API_KEY: '',
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: '.test-uploads',
      LOG_LEVEL: 'silent',
    },
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
    coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/main.ts', 'src/test/**', 'src/**/*.test.ts'], thresholds: { lines: 80 } },
  },
});
