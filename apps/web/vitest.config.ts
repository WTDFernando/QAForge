import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: { provider: 'v8', include: ['src/lib/**', 'src/hooks/use-hotkey.ts', 'src/components/org/audit-timeline.tsx'], exclude: ['src/lib/auth-client.ts', 'src/lib/types.ts'] },
  },
});
