import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    coverage: { provider: 'v8', include: ['src/render.ts'], exclude: ['src/**/*.test.ts'], thresholds: { lines: 80 } },
  },
});
