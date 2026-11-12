import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const TEST_DB = 'postgresql://postgres:postgres@localhost:5432/qaforge_test';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globalSetup: ['src/test/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? TEST_DB,
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
      API_URL: 'http://localhost:4000',
      WEB_URL: 'http://localhost:3000',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: '.test-uploads',
    },
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/test/**', 'src/main.ts', 'src/openapi.ts', 'src/**/*.test.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
