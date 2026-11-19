import path from 'node:path';

/** The parts of Playwright's JSON reporter output we use. */
interface PwAttachment {
  name: string;
  contentType: string;
  path?: string;
}
interface PwResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  duration: number;
  retry: number;
  error?: { message?: string; stack?: string };
  errors?: { message?: string }[];
  stdout?: ({ text?: string } | string)[];
  stderr?: ({ text?: string } | string)[];
  attachments?: PwAttachment[];
}
interface PwTest {
  status: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  results: PwResult[];
}
interface PwSpec {
  title: string;
  file: string;
  line?: number;
  tests: PwTest[];
}
interface PwSuite {
  title: string;
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}
export interface PwReport {
  suites?: PwSuite[];
  errors?: { message?: string }[];
}

export type UiStatus = 'PASSED' | 'FAILED' | 'SKIPPED';

export interface UiTestOutcome {
  /** Workspace path of the spec file, e.g. "checkout/pay.spec.ts" */
  path: string;
  status: UiStatus;
  flaky: boolean;
  attempts: number;
  durationMs: number;
  error: string | null;
  log: string;
  /** One line per test() in the file */
  cases: { title: string; status: PwTest['status']; durationMs: number; error: string | null }[];
  /** Files produced by the final failing attempt: trace.zip, video.webm, screenshots */
  attachments: { name: string; contentType: string; path: string }[];
}

// Playwright errors contain ANSI colour codes.
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
const text = (x: { text?: string } | string) => (typeof x === 'string' ? x : (x.text ?? ''));

function specs(suite: PwSuite, out: PwSpec[] = []): PwSpec[] {
  for (const s of suite.specs ?? []) out.push({ ...s, file: s.file ?? suite.file ?? '' });
  for (const child of suite.suites ?? []) specs({ ...child, file: child.file ?? suite.file }, out);
  return out;
}

/** Group Playwright results by spec file (one automation test = one file). */
export function parseReport(report: PwReport, testDir: string): UiTestOutcome[] {
  const byFile = new Map<string, UiTestOutcome>();
  for (const root of report.suites ?? []) {
    for (const spec of specs(root)) {
      const rel = path.isAbsolute(spec.file) ? path.relative(testDir, spec.file) : spec.file;
      const file = rel.split(path.sep).join('/');
      const o =
        byFile.get(file) ??
        ({
          path: file,
          status: 'PASSED',
          flaky: false,
          attempts: 1,
          durationMs: 0,
          error: null,
          log: '',
          cases: [],
          attachments: [],
        } satisfies UiTestOutcome);
      byFile.set(file, o);
      for (const t of spec.tests) {
        const last = t.results.at(-1);
        const err = last?.error?.message ?? last?.errors?.[0]?.message;
        o.durationMs += t.results.reduce((a, r) => a + r.duration, 0);
        o.attempts = Math.max(o.attempts, t.results.length);
        o.cases.push({
          title: spec.title,
          status: t.status,
          durationMs: last?.duration ?? 0,
          error: err ? stripAnsi(err).slice(0, 4000) : null,
        });
        if (t.status === 'unexpected') {
          o.status = 'FAILED';
          o.error ??= err
            ? `${spec.title}: ${stripAnsi(err).split('\n').slice(0, 12).join('\n')}`
            : `${spec.title} failed`;
          for (const a of last?.attachments ?? [])
            if (a.path)
              o.attachments.push({ name: a.name, contentType: a.contentType, path: a.path });
        } else if (t.status === 'flaky') o.flaky = true;
        for (const r of t.results)
          o.log += [...(r.stdout ?? []), ...(r.stderr ?? [])].map(text).join('');
      }
      if (o.cases.every((c) => c.status === 'skipped')) o.status = 'SKIPPED';
    }
  }
  for (const o of byFile.values()) o.log = stripAnsi(o.log).slice(-20_000);
  return [...byFile.values()];
}
