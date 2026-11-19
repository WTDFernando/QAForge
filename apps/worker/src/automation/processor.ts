import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Job, Queue } from 'bullmq';
import {
  createStorage,
  decryptJson,
  getPrisma,
  insertAutomationRun,
  nextSeq,
  Prisma,
  type AutomationRun,
} from '@qaforge/db';
import {
  createDispatcher,
  nextCronRun,
  redactSecrets,
  runSequence,
  runUiTests,
  type ApiRequestSpec,
  type SandboxDriver,
} from '@qaforge/runner';
import {
  formatRef,
  type ApiAuth,
  type AutomationJob,
  type AutomationSelection,
} from '@qaforge/shared';
import { logger } from '../logger';

const prisma = () => getPrisma();
const json = (v: unknown) => v as Prisma.InputJsonValue;
type Status = 'PASSED' | 'FAILED' | 'SKIPPED';

export interface AutomationDeps {
  /** Overridable for tests (default: RUNNER_SANDBOX / NODE_ENV). */
  driver?: SandboxDriver;
  allowPrivate?: boolean;
  /** Called with each finished run (e.g. to start failure analysis). */
  onFinished?: (run: AutomationRun) => Promise<void> | void;
}

export const allowPrivateDefault = () =>
  process.env.AUTOMATION_ALLOW_PRIVATE_NETWORKS
    ? process.env.AUTOMATION_ALLOW_PRIVATE_NETWORKS === 'true'
    : process.env.NODE_ENV !== 'production';

async function envScope(projectId: string, environmentId: string | null) {
  if (!environmentId)
    return {
      baseUrl: null as string | null,
      env: {} as Record<string, string>,
      secrets: {} as Record<string, string>,
    };
  const e = await prisma().environment.findFirst({ where: { id: environmentId, projectId } });
  if (!e) return { baseUrl: null, env: {}, secrets: {} };
  return {
    baseUrl: e.baseUrl,
    env: {
      ...(e.baseUrl ? { BASE_URL: e.baseUrl } : {}),
      ...((e.variables ?? {}) as Record<string, string>),
    },
    secrets: e.secrets ? decryptJson<Record<string, string>>(e.secrets) : {},
  };
}

/** Requests in tree order (folder positions, then request positions) with inherited auth/vars. */
async function selectRequests(projectId: string, s: AutomationSelection) {
  if (s.kind === 'tests' || s.kind === 'tags') return [];
  const cols = await prisma().apiCollection.findMany({
    where: { projectId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: { requests: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
  });
  const byParent = new Map<string | null, typeof cols>();
  for (const c of cols) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
  const wanted = s.kind === 'collections' ? new Set(s.collectionIds) : null;
  const out: {
    request: (typeof cols)[number]['requests'][number];
    auth: ApiAuth;
    vars: Record<string, string>;
  }[] = [];
  const walk = (
    parentId: string | null,
    inherited: { auth: ApiAuth; vars: Record<string, string> },
    included: boolean,
  ) => {
    for (const c of byParent.get(parentId) ?? []) {
      const auth = (c.auth as ApiAuth).type === 'inherit' ? inherited.auth : (c.auth as ApiAuth);
      const vars = { ...inherited.vars, ...(c.variables as Record<string, string>) };
      const inc = included || !wanted || wanted.has(c.id);
      if (inc) for (const r of c.requests) out.push({ request: r, auth, vars });
      walk(c.id, { auth, vars }, inc);
    }
  };
  walk(null, { auth: { type: 'none' }, vars: {} }, !wanted);
  return out;
}

async function selectTests(projectId: string, s: AutomationSelection) {
  if (s.kind === 'collections') return [];
  return prisma().automationTest.findMany({
    where: {
      projectId,
      deletedAt: null,
      ...(s.kind === 'tests' ? { id: { in: s.testIds } } : { status: { not: 'DISABLED' } }),
      ...(s.kind === 'tags' ? { tags: { hasSome: s.tags } } : {}),
    },
    orderBy: { path: 'asc' },
  });
}

async function cancelled(runId: string) {
  return (
    (await prisma().automationRun.findUnique({ where: { id: runId }, select: { status: true } }))
      ?.status === 'CANCELLED'
  );
}

/** Execute one automation run end to end. */
export async function executeAutomationRun(runId: string, deps: AutomationDeps = {}) {
  const db = prisma();
  let run = await db.automationRun.findUnique({ where: { id: runId }, include: { project: true } });
  if (!run || run.status !== 'QUEUED') return { skipped: true };
  const project = run.project;
  const actorId = run.createdById ?? project.createdById;
  run = await db.automationRun.update({
    where: { id: runId },
    data: { status: 'RUNNING', startedAt: new Date() },
    include: { project: true },
  });
  const started = Date.now();
  const selection = run.selection as AutomationSelection;
  const scope = await envScope(project.id, run.environmentId);
  const redact = (s: string | null | undefined) =>
    s ? redactSecrets(s, scope.secrets) : (s ?? null);
  let position = 0;
  const results: {
    id: string;
    status: Status;
    flaky: boolean;
    quarantined: boolean;
    testCaseId: string | null;
    name: string;
    durationMs: number | null;
  }[] = [];
  let runnerError: string | null = null;

  try {
    // ---- API requests -------------------------------------------------------------
    const requests = await selectRequests(project.id, selection);
    if (requests.length) {
      const allowPrivate = deps.allowPrivate ?? allowPrivateDefault();
      const dispatcher = createDispatcher({ allowPrivate, timeoutMs: 30_000 });
      const vars: Record<string, string> = { ...(scope.baseUrl ? { baseUrl: scope.baseUrl } : {}) };
      const tokenCache = new Map();
      try {
        for (const { request: r, auth, vars: folderVars } of requests) {
          if (await cancelled(runId)) break;
          const spec: ApiRequestSpec = {
            name: r.name,
            method: r.method,
            url: r.url,
            headers: r.headers as ApiRequestSpec['headers'],
            query: r.query as ApiRequestSpec['query'],
            body: r.body as ApiRequestSpec['body'],
            auth: (r.auth as ApiAuth | null) ?? null,
            assertions: r.assertions as ApiRequestSpec['assertions'],
            extract: r.extract as ApiRequestSpec['extract'],
          };
          const ctxVars = { ...folderVars, ...vars };
          const [x] = await runSequence([spec], {
            scope: { vars: ctxVars, env: scope.env, secrets: scope.secrets },
            collectionAuth: auth,
            allowPrivate,
            dispatcher,
            timeoutMs: 30_000,
            tokenCache,
          });
          // Values extracted by this request are available to every later request in the run.
          Object.assign(vars, x!.extracted);
          const status: Status = x!.passed ? 'PASSED' : 'FAILED';
          const failed = x!.assertions.filter((a) => !a.passed).map((a) => a.message);
          const row = await db.automationResult.create({
            data: {
              automationRunId: runId,
              apiRequestId: r.id,
              name: r.name,
              status,
              durationMs: x!.durationMs,
              error: x!.error ?? (failed.length ? failed.join('\n') : null),
              exchange: json({
                ...x!.exchange,
                assertions: x!.assertions,
                extracted: Object.keys(x!.extracted),
              }),
              position: position++,
            },
          });
          results.push({
            id: row.id,
            status,
            flaky: false,
            quarantined: false,
            testCaseId: r.testCaseId,
            name: r.name,
            durationMs: x!.durationMs,
          });
        }
      } finally {
        await dispatcher.close();
      }
    }

    // ---- Playwright UI tests -------------------------------------------------------------
    const tests = await selectTests(project.id, selection);
    if (tests.length && !(await cancelled(runId))) {
      const ui = await runUiTests(
        tests.map((t) => ({ id: t.id, path: t.path, code: t.code })),
        {
          baseURL: scope.baseUrl,
          env: { ...scope.env, ...scope.secrets },
          retries: run.retries,
          driver: deps.driver,
        },
      );
      try {
        runnerError = redact(ui.error);
        const storage = createStorage();
        for (const o of ui.outcomes) {
          const t = tests.find((x) => x.id === o.id)!;
          const row = await db.automationResult.create({
            data: {
              automationRunId: runId,
              automationTestId: t.id,
              name: t.name,
              status: o.status,
              flaky: o.flaky,
              attempts: o.attempts,
              durationMs: o.durationMs,
              error: redact(o.error),
              log: redact(o.log)?.slice(-20_000) ?? null,
              exchange: json({
                cases: o.cases.map((c) => ({ ...c, error: redact(c.error) })),
                driver: ui.driver,
              }),
              position: position++,
            },
          });
          // Evidence from the failing attempt: trace, video, screenshots.
          for (const a of o.attachments.slice(0, 10)) {
            const body = await readFile(a.path).catch(() => null);
            if (!body || body.length > 100 * 1024 * 1024) continue;
            const id = randomUUID();
            const fileName = `${a.name.replace(/[^\w.-]/g, '_')}${path.extname(a.path)}`;
            const key = `${project.organizationId}/${project.id}/${id}/${fileName}`;
            await storage.put(key, body, a.contentType);
            await db.attachment.create({
              data: {
                id,
                projectId: project.id,
                storageKey: key,
                fileName,
                contentType: a.contentType,
                size: body.length,
                entityType: 'automation_result',
                entityId: row.id,
                scanStatus: 'SKIPPED',
                createdById: actorId,
              },
            });
          }
          results.push({
            id: row.id,
            status: o.status,
            flaky: o.flaky,
            quarantined: t.status === 'QUARANTINED',
            testCaseId: t.testCaseId,
            name: t.name,
            durationMs: o.durationMs,
          });
          await updateFlakyScore(t.id);
        }
      } finally {
        await ui.cleanup();
      }
    }
  } catch (e) {
    runnerError = redact((e as Error).message) ?? 'Unexpected error';
    logger.error({ runId, err: e }, 'automation run failed');
  }

  if (await cancelled(runId)) return { cancelled: true };

  // Quarantined tests still run and report, but don't fail the run.
  const counted = results.filter((r) => !r.quarantined);
  const totals = {
    total: results.length,
    passed: results.filter((r) => r.status === 'PASSED').length,
    failed: results.filter((r) => r.status === 'FAILED').length,
    flaky: results.filter((r) => r.flaky).length,
    skipped: results.filter((r) => r.status === 'SKIPPED').length,
    quarantined: results.filter((r) => r.quarantined).length,
    durationMs: Date.now() - started,
  };
  const status =
    runnerError && !results.length
      ? 'ERROR'
      : counted.some((r) => r.status === 'FAILED')
        ? 'FAILED'
        : runnerError
          ? 'ERROR'
          : 'PASSED';
  const finished = await db.$transaction(async (tx) => {
    const testRunId = await mirrorToTestRun(tx, run!, results, actorId);
    const r = await tx.automationRun.update({
      where: { id: runId },
      data: { status, totals: json(totals), error: runnerError, finishedAt: new Date(), testRunId },
    });
    await tx.auditLog.create({
      data: {
        organizationId: project.organizationId,
        projectId: project.id,
        actorType: 'SYSTEM',
        entityType: 'automation_run',
        entityId: runId,
        action: 'complete',
        metadata: json({ ref: formatRef('automationRun', run!.seq), status, totals }),
      },
    });
    if (status !== 'PASSED' && run!.createdById) {
      await tx.notification.create({
        data: {
          organizationId: project.organizationId,
          projectId: project.id,
          userId: run!.createdById,
          type: 'automation.failed',
          title: `${formatRef('automationRun', run!.seq)} ${status === 'ERROR' ? 'could not finish' : `failed: ${totals.failed} of ${totals.total}`}`,
          body:
            runnerError ??
            results
              .filter((x) => x.status === 'FAILED')
              .slice(0, 3)
              .map((x) => x.name)
              .join(', '),
          entityType: 'automation_run',
          entityId: runId,
        },
      });
    }
    return r;
  });
  await deps.onFinished?.(finished);
  return { status, totals };
}

/** Rolling flakiness over the last 10 results: share that passed only on retry. */
async function updateFlakyScore(testId: string) {
  const recent = await prisma().automationResult.findMany({
    where: { automationTestId: testId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { flaky: true },
  });
  const score = recent.length ? recent.filter((r) => r.flaky).length / recent.length : 0;
  await prisma().automationTest.update({
    where: { id: testId },
    data: { flakyScore: Math.round(score * 100) / 100 },
  });
}

/** Results linked to test cases appear in a regular Test Run (source AUTOMATION). */
async function mirrorToTestRun(
  tx: Prisma.TransactionClient,
  run: AutomationRun,
  results: { id: string; status: Status; testCaseId: string | null; durationMs: number | null }[],
  actorId: string,
) {
  const linked = results.filter((r) => r.testCaseId);
  if (!linked.length) return null;
  const cases = await tx.testCase.findMany({
    where: { id: { in: linked.map((l) => l.testCaseId!) }, deletedAt: null },
    include: { steps: { orderBy: { position: 'asc' }, include: { sharedStep: true } } },
  });
  const byId = new Map(cases.map((c) => [c.id, c]));
  const seq = await nextSeq(tx, run.projectId, 'testRun');
  const tr = await tx.testRun.create({
    data: {
      projectId: run.projectId,
      seq,
      name: `${formatRef('automationRun', run.seq)} · automated`,
      status: 'COMPLETED',
      source: 'AUTOMATION',
      sourceConfig: json({ automationRunId: run.id }),
      environmentId: run.environmentId,
      build: run.build,
      startedAt: run.startedAt ?? new Date(),
      completedAt: new Date(),
      createdById: actorId,
      updatedById: actorId,
    },
  });
  let position = 0;
  for (const l of linked) {
    const tc = byId.get(l.testCaseId!);
    if (!tc) continue;
    await tx.testRunResult.create({
      data: {
        testRunId: tr.id,
        testCaseId: tc.id,
        testCaseVersion: tc.version,
        position: position++,
        status: l.status,
        snapshot: json({
          ref: formatRef('testCase', tc.seq),
          title: tc.title,
          preconditions: tc.preconditions,
          steps: tc.steps.flatMap((s) =>
            s.sharedStep
              ? (s.sharedStep.steps as unknown[])
              : [{ action: s.action, expected: s.expected }],
          ),
          testData: tc.testData,
          priority: tc.priority,
          type: tc.type,
        }),
        executedById: actorId,
        executedAt: new Date(),
        durationSec: l.durationMs ? Math.round(l.durationMs / 1000) : null,
        automationResultId: l.id,
      },
    });
  }
  return tr.id;
}

/** Every minute: start runs for schedules that are due. */
export async function scheduleTick(enqueue: (runId: string) => Promise<unknown>, now = new Date()) {
  const due = await prisma().automationSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    take: 100,
  });
  const started: string[] = [];
  for (const s of due) {
    const run = await prisma().$transaction(async (tx) => {
      // Claim the schedule first so two workers never start the same slot twice.
      const claimed = await tx.automationSchedule.updateMany({
        where: { id: s.id, nextRunAt: s.nextRunAt },
        data: { lastRunAt: now, nextRunAt: nextCronRun(s.cron, s.timezone, now) },
      });
      if (!claimed.count) return null;
      return insertAutomationRun(tx, {
        projectId: s.projectId,
        trigger: 'SCHEDULE',
        triggerRef: s.id,
        scheduleId: s.id,
        selection: s.selection as Prisma.InputJsonValue,
        environmentId: s.environmentId,
        createdById: s.createdById,
      });
    });
    if (run) {
      await enqueue(run.id);
      started.push(run.id);
    }
  }
  return started;
}

export function createAutomationProcessor(queue: Queue<AutomationJob>, deps: AutomationDeps = {}) {
  return async function processAutomationJob(job: Job<AutomationJob>) {
    if (job.name === 'tick')
      return {
        started: await scheduleTick((id) =>
          queue.add(
            'run',
            { automationRunId: id },
            { jobId: id, removeOnComplete: 1000, removeOnFail: 1000 },
          ),
        ),
      };
    return executeAutomationRun(job.data.automationRunId, deps);
  };
}
