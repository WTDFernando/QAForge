import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface WorkspaceTest {
  id: string;
  /** Validated workspace path, e.g. "checkout/pay.spec.ts" */
  path: string;
  code: string;
}

export interface WorkspaceOptions {
  baseURL?: string | null;
  retries: number;
  /** Per-test timeout */
  timeoutMs: number;
  workers: number;
  /** Link @playwright/test into the workspace (process driver). Docker images ship their own copy. */
  linkPackages?: boolean;
}

export interface Workspace {
  dir: string;
  reportFile: string;
  outputDir: string;
  cleanup: () => Promise<void>;
}

const SAFE_PATH = /^(?:[a-z0-9][a-z0-9-_]*\/){0,5}[a-z0-9][a-z0-9-_.]*\.spec\.ts$/i;

/** The generated config. Values are JSON-encoded, never interpolated as code. */
export function configSource(opts: WorkspaceOptions) {
  return `import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  outputDir: './results',
  timeout: ${JSON.stringify(opts.timeoutMs)},
  retries: ${JSON.stringify(opts.retries)},
  workers: ${JSON.stringify(opts.workers)},
  forbidOnly: true,
  reporter: [['json', { outputFile: './report.json' }], ['line']],
  use: {
    baseURL: ${JSON.stringify(opts.baseURL ?? undefined) ?? 'undefined'},
    headless: true,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
});
`;
}

/**
 * Write the tests and a generated config to a fresh temp directory. `@playwright/test` is linked in
 * so test files can import it (Docker images ship their own copy at the same path).
 */
export async function createWorkspace(
  tests: WorkspaceTest[],
  opts: WorkspaceOptions,
): Promise<Workspace> {
  const dir = await mkdtemp(path.join(tmpdir(), 'qaforge-run-'));
  try {
    for (const t of tests) {
      if (!SAFE_PATH.test(t.path)) throw new Error(`Invalid test path: ${t.path}`);
      const file = path.join(dir, 'tests', t.path);
      if (!file.startsWith(path.join(dir, 'tests') + path.sep))
        throw new Error(`Invalid test path: ${t.path}`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, t.code);
    }
    await writeFile(path.join(dir, 'playwright.config.ts'), configSource(opts));
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'qaforge-run', private: true, type: 'commonjs' }),
    );
    if (opts.linkPackages === false) return finish(dir);
    const req = createRequire(__filename);
    const pkgDir = path.dirname(req.resolve('@playwright/test/package.json'));
    await mkdir(path.join(dir, 'node_modules', '@playwright'), { recursive: true });
    await symlink(pkgDir, path.join(dir, 'node_modules', '@playwright', 'test'), 'dir');
    // @playwright/test re-exports `playwright`; link it next to it so resolution works from the workspace.
    const pwDir = path.dirname(
      createRequire(path.join(pkgDir, 'package.json')).resolve('playwright/package.json'),
    );
    await symlink(pwDir, path.join(dir, 'node_modules', 'playwright'), 'dir');
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
  return finish(dir);
}

function finish(dir: string): Workspace {
  return {
    dir,
    reportFile: path.join(dir, 'report.json'),
    outputDir: path.join(dir, 'results'),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
