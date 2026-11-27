import {
  BUG_SEVERITIES,
  OPEN_BUG_STATUSES,
  percentage,
  PRIORITIES,
  type ReleaseMetrics,
} from '@qaforge/shared';
import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** Latest result per test case (and data row) across the given runs; untested results don't override executed ones. */
export async function latestResults(db: Db, testRunIds: string[]) {
  if (!testRunIds.length) return [];
  const rows = await db.testRunResult.findMany({
    where: { testRunId: { in: testRunIds } },
    select: {
      id: true,
      testCaseId: true,
      dataRowIndex: true,
      status: true,
      executedAt: true,
      updatedAt: true,
      testRunId: true,
    },
  });
  const byKey = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = r.testCaseId ? `${r.testCaseId}:${r.dataRowIndex ?? ''}` : r.id;
    const prev = byKey.get(key);
    const rank = (x: typeof r) => [
      x.status === 'UNTESTED' ? 0 : 1,
      (x.executedAt ?? x.updatedAt).getTime(),
    ];
    if (!prev) byKey.set(key, r);
    else {
      const [a1, a2] = rank(r);
      const [b1, b2] = rank(prev);
      if (a1! > b1! || (a1 === b1 && a2! > b2!)) byKey.set(key, r);
    }
  }
  return [...byKey.values()];
}

/** Bugs that count against a release: in scope, or found in one of its runs. */
export async function releaseBugs(db: Db, releaseId: string, testRunIds: string[]) {
  return db.bug.findMany({
    where: {
      deletedAt: null,
      OR: [
        { releaseItems: { some: { releaseId } } },
        ...(testRunIds.length ? [{ testRunResult: { testRunId: { in: testRunIds } } }] : []),
      ],
    },
    select: {
      id: true,
      seq: true,
      title: true,
      status: true,
      severity: true,
      priority: true,
      component: true,
      assigneeId: true,
      createdAt: true,
      closedAt: true,
    },
    orderBy: { seq: 'asc' },
  });
}

/**
 * Everything the gates, readiness score and Go/No-Go report need, measured from the database.
 * Definitions match GATE_METRIC_INFO in @qaforge/shared.
 */
export async function computeReleaseMetrics(db: Db, releaseId: string): Promise<ReleaseMetrics> {
  const runs = await db.testRun.findMany({
    where: { releaseId, deletedAt: null },
    select: { id: true, source: true },
  });
  const runIds = runs.map((r) => r.id);
  const automatedRunIds = new Set(runs.filter((r) => r.source === 'AUTOMATION').map((r) => r.id));
  const latest = await latestResults(db, runIds);
  const executed = latest.filter((r) => r.status !== 'UNTESTED');
  const count = (s: string, list = latest) => list.filter((r) => r.status === s).length;
  const auto = executed.filter((r) => automatedRunIds.has(r.testRunId));

  // Requirement coverage: linked test cases executed (and passed) in the release.
  const reqs = await db.requirement.findMany({
    where: { deletedAt: null, releaseItems: { some: { releaseId } } },
    select: { id: true, priority: true, testCases: { select: { testCaseId: true } } },
  });
  const statusByCase = new Map<string, string[]>();
  for (const r of executed) {
    if (!r.testCaseId) continue;
    statusByCase.set(r.testCaseId, [...(statusByCase.get(r.testCaseId) ?? []), r.status]);
  }
  const priorityCoverage = Object.fromEntries(
    PRIORITIES.map((p) => [p, { total: 0, passed: 0 }]),
  ) as ReleaseMetrics['priorityCoverage'];
  let covered = 0;
  for (const q of reqs) {
    const statuses = q.testCases.flatMap((t) => statusByCase.get(t.testCaseId) ?? []);
    if (statuses.length) covered++;
    const pc = priorityCoverage[q.priority as keyof typeof priorityCoverage];
    if (pc) {
      pc.total++;
      if (statuses.length && statuses.every((s) => s === 'PASSED')) pc.passed++;
    }
  }

  const bugs = await releaseBugs(db, releaseId, runIds);
  const openBugs = Object.fromEntries(
    BUG_SEVERITIES.map((s) => [s, 0]),
  ) as ReleaseMetrics['openBugs'];
  for (const b of bugs)
    if ((OPEN_BUG_STATUSES as readonly string[]).includes(b.status))
      openBugs[b.severity as keyof typeof openBugs]++;

  const passed = count('PASSED');
  return {
    passRate: percentage(passed, executed.length),
    executionComplete: percentage(executed.length, latest.length),
    openBugs,
    requirementCoverage: percentage(covered, reqs.length),
    priorityCoverage,
    automationPassRate: percentage(count('PASSED', auto), auto.length),
    counts: {
      testCases: latest.length,
      executed: executed.length,
      passed,
      failed: count('FAILED'),
      blocked: count('BLOCKED'),
      skipped: count('SKIPPED'),
      requirements: reqs.length,
      requirementsCovered: covered,
      testRuns: runs.length,
      automatedExecuted: auto.length,
      automatedPassed: count('PASSED', auto),
    },
  };
}
