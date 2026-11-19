import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { createDriver, type SandboxDriver } from './drivers';
import { parseReport, type PwReport, type UiTestOutcome } from './results';
import { createWorkspace, type WorkspaceTest } from './workspace';

export interface UiRunOptions {
  baseURL?: string | null;
  /** Environment variables and secrets exposed to tests as process.env.NAME */
  env?: Record<string, string>;
  retries?: number;
  timeoutPerTestMs?: number;
  /** Hard limit for the whole run (default 15 min) */
  timeoutMs?: number;
  workers?: number;
  driver?: SandboxDriver;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
}

export interface UiRunResult {
  /** Outcome per test file, in input order; tests missing from the report are errors */
  outcomes: (UiTestOutcome & { id: string })[];
  driver: string;
  timedOut: boolean;
  /** Set when Playwright itself failed (config/compile error, sandbox unavailable) */
  error: string | null;
  output: string;
  /** Call after storing attachments: deletes the workspace */
  cleanup: () => Promise<void>;
}

/**
 * A syntax error in one file makes Playwright abort the whole run, so files that don't parse are
 * reported on their own and left out of the run. Returns null when the file parses.
 */
export function syntaxError(code: string, fileName = 'test.spec.ts'): string | null {
  const out = ts.transpileModule(code, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const d = out.diagnostics?.find((x) => x.category === ts.DiagnosticCategory.Error);
  if (!d) return null;
  const pos =
    d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
  const where = pos ? ` at line ${pos.line + 1}, column ${pos.character + 1}` : '';
  return `Syntax error${where}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
}

const failedOutcome = (t: WorkspaceTest, error: string) => ({
  id: t.id,
  path: t.path,
  status: 'FAILED' as const,
  flaky: false,
  attempts: 0,
  durationMs: 0,
  error,
  log: '',
  cases: [],
  attachments: [],
});

/** Run Playwright test files in a sandbox and map the report back to the input tests. */
export async function runUiTests(
  all: WorkspaceTest[],
  opts: UiRunOptions = {},
): Promise<UiRunResult> {
  const driver = opts.driver ?? createDriver();
  const broken = new Map<string, string>();
  for (const t of all) {
    const err = syntaxError(t.code, t.path);
    if (err) broken.set(t.id, err);
  }
  const tests = all.filter((t) => !broken.has(t.id));
  const outcomeFor = (
    t: WorkspaceTest,
    byPath: Map<string, UiTestOutcome>,
    error: string | null,
  ): UiTestOutcome & { id: string } =>
    broken.has(t.id)
      ? failedOutcome(t, broken.get(t.id)!)
      : byPath.has(t.path)
        ? { id: t.id, ...byPath.get(t.path)! }
        : failedOutcome(
            t,
            error ?? 'This file produced no results (no test() found, or it failed to compile).',
          );
  if (!tests.length)
    return {
      outcomes: all.map((t) => outcomeFor(t, new Map(), null)),
      driver: driver.name,
      timedOut: false,
      error: null,
      output: '',
      cleanup: async () => {},
    };
  const ws = await createWorkspace(tests, {
    baseURL: opts.baseURL,
    retries: opts.retries ?? 1,
    timeoutMs: opts.timeoutPerTestMs ?? 30_000,
    workers: opts.workers ?? 1,
    linkPackages: driver.name === 'process',
  });
  try {
    const exec = await driver.run({
      dir: ws.dir,
      env: { ...(opts.baseURL ? { BASE_URL: opts.baseURL } : {}), ...opts.env },
      timeoutMs: opts.timeoutMs ?? 15 * 60_000,
      signal: opts.signal,
      onOutput: opts.onOutput,
    });
    let report: PwReport | null = null;
    try {
      report = JSON.parse(await readFile(ws.reportFile, 'utf8')) as PwReport;
    } catch {
      /* no report: Playwright did not run */
    }
    const outcomes = report ? parseReport(report, path.join(ws.dir, 'tests')) : [];
    const byPath = new Map(outcomes.map((o) => [o.path, o]));
    const globalError =
      report?.errors
        ?.map((e) => e.message)
        .filter(Boolean)
        .join('\n') || null;
    const error = exec.timedOut
      ? `The run exceeded ${Math.round((opts.timeoutMs ?? 900_000) / 1000)} s and was stopped`
      : !report
        ? `Playwright did not produce a report (exit code ${exec.exitCode}). ${exec.output.slice(-2000)}`
        : globalError;
    // page.goto('/path') needs a base URL; say so instead of Playwright's "invalid URL".
    const hint = (o: UiTestOutcome & { id: string }) =>
      !opts.baseURL && o.error?.includes('Cannot navigate to invalid URL')
        ? {
            ...o,
            error: `${o.error}\n\nNo base URL: run with an environment that has a base URL, or use absolute URLs.`,
          }
        : o;
    return {
      outcomes: all.map((t) => hint(outcomeFor(t, byPath, error))),
      driver: driver.name,
      timedOut: exec.timedOut,
      error: error?.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 8000) ?? null,
      output: exec.output.replace(/\u001b\[[0-9;]*m/g, '').slice(-50_000),
      cleanup: ws.cleanup,
    };
  } catch (e) {
    await ws.cleanup();
    throw e;
  }
}
