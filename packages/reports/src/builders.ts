import {
  BUG_SEVERITIES,
  evaluateGate,
  formatRef,
  GATE_METRIC_INFO,
  OPEN_BUG_STATUSES,
  percentage,
  readiness,
  REPORT_TYPE_INFO,
  type GateInput,
  type ReportDoc,
  type ReportKpi,
  type ReportParams,
  type ReportSection,
  type ReportType,
  type Tone,
  type Verdict,
} from '@qaforge/shared';
import {
  computeReleaseMetrics,
  latestResults,
  releaseBugs,
  type Prisma,
  type PrismaClient,
} from '@qaforge/db';

type Db = PrismaClient | Prisma.TransactionClient;

export interface BuildContext {
  db: Db;
  projectId: string;
  params: ReportParams;
  now?: Date;
}

/** Big tables are cut so a PDF stays readable; the full data is in the XLSX export. */
const MAX_ROWS = 500;
const DAY = 86_400_000;
const isOpen = (s: string) => (OPEN_BUG_STATUSES as readonly string[]).includes(s);
const pctText = (n: number | null) => (n === null ? '—' : `${n}%`);
const day = (d: Date) => d.toISOString().slice(0, 10);
const toneForRate = (n: number | null, good = 95, warn = 80): Tone =>
  n === null ? 'neutral' : n >= good ? 'good' : n >= warn ? 'warn' : 'bad';
const STATUS_TONE: Record<string, Tone> = {
  PASSED: 'good',
  FAILED: 'bad',
  BLOCKED: 'warn',
  SKIPPED: 'neutral',
  UNTESTED: 'neutral',
  RETEST: 'warn',
};
const status = (s: string) => ({
  text: s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' '),
  tone: STATUS_TONE[s] ?? 'neutral',
});

function cap<T>(rows: T[]) {
  return { rows: rows.slice(0, MAX_ROWS), omitted: Math.max(0, rows.length - MAX_ROWS) };
}

function period(ctx: BuildContext) {
  const to = ctx.params.to ?? ctx.now ?? new Date();
  const from = ctx.params.from ?? new Date(to.getTime() - 14 * DAY);
  return { from, to };
}

async function header(ctx: BuildContext, type: ReportType, subtitle: string) {
  const p = await ctx.db.project.findUniqueOrThrow({
    where: { id: ctx.projectId },
    select: { name: true, key: true },
  });
  return {
    version: 1 as const,
    type,
    title: REPORT_TYPE_INFO[type].label,
    subtitle,
    project: p,
    generatedAt: (ctx.now ?? new Date()).toISOString(),
  };
}

async function releaseOf(ctx: BuildContext) {
  if (!ctx.params.releaseId) return null;
  return ctx.db.release.findFirst({
    where: { id: ctx.params.releaseId, projectId: ctx.projectId, deletedAt: null },
  });
}

// ---- test execution ---------------------------------------------------------------------------

export async function testExecution(ctx: BuildContext): Promise<ReportDoc> {
  const release = await releaseOf(ctx);
  const runs = await ctx.db.testRun.findMany({
    where: {
      projectId: ctx.projectId,
      deletedAt: null,
      ...(ctx.params.testRunIds?.length
        ? { id: { in: ctx.params.testRunIds } }
        : { releaseId: release?.id ?? '00000000-0000-0000-0000-000000000000' }),
    },
    include: { environment: { select: { name: true } } },
    orderBy: { seq: 'asc' },
  });
  const runIds = runs.map((r) => r.id);
  const results = await ctx.db.testRunResult.findMany({
    where: { testRunId: { in: runIds } },
    orderBy: [{ testRun: { seq: 'asc' } }, { position: 'asc' }],
    select: {
      id: true,
      testRunId: true,
      status: true,
      notes: true,
      executedById: true,
      snapshot: true,
      testCase: { select: { seq: true, title: true, suite: { select: { name: true } } } },
      bugs: { select: { seq: true }, where: { deletedAt: null } },
    },
  });
  const latest = await latestResults(ctx.db, runIds);
  const count = (s: string) => latest.filter((r) => r.status === s).length;
  const executed = latest.filter((r) => r.status !== 'UNTESTED').length;
  const passRate = percentage(count('PASSED'), executed);
  const testers = await ctx.db.user.findMany({
    where: {
      id: { in: [...new Set(results.map((r) => r.executedById).filter(Boolean) as string[])] },
    },
    select: { id: true, name: true },
  });
  const testerName = new Map(testers.map((t) => [t.id, t.name]));

  const runRows = runs.map((r) => {
    const rs = results.filter((x) => x.testRunId === r.id);
    const ex = rs.filter((x) => x.status !== 'UNTESTED');
    const pr = percentage(rs.filter((x) => x.status === 'PASSED').length, ex.length);
    return {
      run: formatRef('testRun', r.seq),
      name: r.name,
      environment: r.environment?.name ?? '—',
      build: r.build ?? '—',
      total: rs.length,
      executed: ex.length,
      failed: rs.filter((x) => x.status === 'FAILED').length,
      passRate: { text: pctText(pr), tone: toneForRate(pr) },
    };
  });

  const group = (key: (r: (typeof results)[number]) => string) => {
    const m = new Map<
      string,
      { total: number; passed: number; failed: number; executed: number }
    >();
    for (const r of results) {
      const k = key(r);
      const g = m.get(k) ?? { total: 0, passed: 0, failed: 0, executed: 0 };
      g.total++;
      if (r.status !== 'UNTESTED') g.executed++;
      if (r.status === 'PASSED') g.passed++;
      if (r.status === 'FAILED') g.failed++;
      m.set(k, g);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
  };
  const runRef = new Map(runs.map((r) => [r.id, formatRef('testRun', r.seq)]));
  const title = (r: (typeof results)[number]) =>
    r.testCase?.title ?? (r.snapshot as { title?: string } | null)?.title ?? 'Deleted test case';
  const failures = results
    .filter((r) => r.status === 'FAILED' || r.status === 'BLOCKED')
    .map((r) => ({
      case: r.testCase ? formatRef('testCase', r.testCase.seq) : '—',
      title: title(r),
      run: runRef.get(r.testRunId) ?? '',
      status: status(r.status),
      notes: r.notes.slice(0, 300),
      bugs: r.bugs.map((b) => formatRef('bug', b.seq)).join(', ') || '—',
    }));

  const sections: ReportSection[] = [
    {
      kind: 'bars',
      title: 'Results by status',
      description: 'Latest result of each test case across the selected runs',
      series: (['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED', 'UNTESTED'] as const).map((s) => ({
        label: status(s).text,
        value: count(s),
        tone: STATUS_TONE[s],
      })),
    },
    {
      kind: 'table',
      title: 'Test runs',
      columns: [
        { key: 'run', label: 'Run' },
        { key: 'name', label: 'Name' },
        { key: 'environment', label: 'Environment' },
        { key: 'build', label: 'Build' },
        { key: 'total', label: 'Cases', align: 'right' },
        { key: 'executed', label: 'Executed', align: 'right' },
        { key: 'failed', label: 'Failed', align: 'right' },
        { key: 'passRate', label: 'Pass rate', align: 'right' },
      ],
      rows: runRows,
      empty: 'No test runs selected.',
    },
    {
      kind: 'table',
      title: 'By suite',
      columns: [
        { key: 'suite', label: 'Suite' },
        { key: 'total', label: 'Cases', align: 'right' },
        { key: 'passed', label: 'Passed', align: 'right' },
        { key: 'failed', label: 'Failed', align: 'right' },
        { key: 'passRate', label: 'Pass rate', align: 'right' },
      ],
      rows: group((r) => r.testCase?.suite?.name ?? 'No suite').map(([suite, g]) => {
        const pr = percentage(g.passed, g.executed);
        return {
          suite,
          total: g.total,
          passed: g.passed,
          failed: g.failed,
          passRate: { text: pctText(pr), tone: toneForRate(pr) },
        };
      }),
    },
    {
      kind: 'table',
      title: 'By tester',
      columns: [
        { key: 'tester', label: 'Tester' },
        { key: 'executed', label: 'Executed', align: 'right' },
        { key: 'passed', label: 'Passed', align: 'right' },
        { key: 'failed', label: 'Failed', align: 'right' },
      ],
      rows: group((r) =>
        r.executedById ? (testerName.get(r.executedById) ?? 'Former member') : 'Not executed',
      )
        .filter(([t]) => t !== 'Not executed')
        .map(([tester, g]) => ({
          tester,
          executed: g.executed,
          passed: g.passed,
          failed: g.failed,
        })),
      empty: 'Nothing executed yet.',
    },
    {
      kind: 'table',
      title: 'Failed and blocked',
      columns: [
        { key: 'case', label: 'Case' },
        { key: 'title', label: 'Title' },
        { key: 'run', label: 'Run' },
        { key: 'status', label: 'Status' },
        { key: 'notes', label: 'Notes' },
        { key: 'bugs', label: 'Bugs' },
      ],
      ...cap(failures),
      empty: 'No failed or blocked results.',
    },
  ];
  const head = await header(
    ctx,
    'TEST_EXECUTION',
    release
      ? `${formatRef('release', release.seq)} ${release.name} (${release.version})`
      : runs.map((r) => formatRef('testRun', r.seq)).join(', ') || 'No runs',
  );
  return {
    ...head,
    kpis: [
      { label: 'Pass rate', value: pctText(passRate), tone: toneForRate(passRate) },
      { label: 'Executed', value: `${executed} of ${latest.length}` },
      { label: 'Failed', value: count('FAILED'), tone: count('FAILED') ? 'bad' : 'good' },
      { label: 'Blocked', value: count('BLOCKED'), tone: count('BLOCKED') ? 'warn' : 'neutral' },
      { label: 'Test runs', value: runs.length },
    ],
    sections,
  };
}

// ---- go / no-go --------------------------------------------------------------------------------

export async function goNoGo(ctx: BuildContext): Promise<ReportDoc> {
  const release = await releaseOf(ctx);
  if (!release) throw new Error('Release not found');
  const db = ctx.db;
  const [metrics, gates, approvals, runs, scope] = await Promise.all([
    computeReleaseMetrics(db, release.id),
    db.qualityGate.findMany({ where: { releaseId: release.id }, orderBy: { position: 'asc' } }),
    db.approval.findMany({
      where: { releaseId: release.id },
      include: { approver: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.testRun.findMany({
      where: { releaseId: release.id, deletedAt: null },
      select: { id: true },
    }),
    db.releaseItem.findMany({
      where: { releaseId: release.id, requirementId: { not: null } },
      include: {
        requirement: {
          select: {
            seq: true,
            title: true,
            priority: true,
            testCases: { select: { testCaseId: true } },
          },
        },
      },
    }),
  ]);
  const results = gates.map((g) =>
    evaluateGate(metrics, {
      metric: g.metric,
      operator: g.operator,
      threshold: g.threshold,
      params: (g.params ?? {}) as GateInput['params'],
      blocking: g.blocking,
    }),
  );
  const ready = readiness(metrics, results);
  const verdict: Verdict =
    ready.band === 'READY' ? 'GO' : ready.band === 'AT_RISK' ? 'GO_WITH_RISKS' : 'NO_GO';
  const failedGates = results.filter((g) => !g.passed);
  const reason =
    ready.band === 'BLOCKED'
      ? `${ready.blockingFailed} blocking quality gate${ready.blockingFailed === 1 ? '' : 's'} not met`
      : ready.band === 'READY'
        ? `All blocking gates pass and readiness is ${ready.score} of 100`
        : `Readiness is ${ready.score} of 100${failedGates.length ? `; ${failedGates.length} gate${failedGates.length === 1 ? '' : 's'} not met` : ''}`;

  const bugs = (
    await releaseBugs(
      db,
      release.id,
      runs.map((r) => r.id),
    )
  ).filter((b) => isOpen(b.status));
  const latest = await latestResults(
    db,
    runs.map((r) => r.id),
  );
  const byCase = new Map<string, string[]>();
  for (const r of latest)
    if (r.testCaseId && r.status !== 'UNTESTED')
      byCase.set(r.testCaseId, [...(byCase.get(r.testCaseId) ?? []), r.status]);
  const opLabel = { GTE: '≥', LTE: '≤', EQ: '=' } as const;
  const unit = (m: keyof typeof GATE_METRIC_INFO) => (GATE_METRIC_INFO[m].unit === '%' ? '%' : '');

  const sections: ReportSection[] = [
    {
      kind: 'table',
      title: 'Quality gates',
      columns: [
        { key: 'gate', label: 'Gate' },
        { key: 'target', label: 'Target', align: 'right' },
        { key: 'actual', label: 'Actual', align: 'right' },
        { key: 'result', label: 'Result' },
        { key: 'blocking', label: 'Blocking' },
      ],
      rows: results.map((g) => ({
        gate:
          GATE_METRIC_INFO[g.metric].label +
          (g.params.severities?.length ? ` (${g.params.severities.join(', ').toLowerCase()})` : ''),
        target: `${opLabel[g.operator]} ${g.threshold}${unit(g.metric)}`,
        actual: g.actual === null ? '—' : `${g.actual}${unit(g.metric)}`,
        result: g.passed
          ? { text: 'Met', tone: 'good' }
          : { text: 'Not met', tone: g.blocking ? 'bad' : 'warn' },
        blocking: g.blocking ? 'Yes' : 'No',
      })),
      empty: 'No quality gates set.',
    },
    {
      kind: 'bars',
      title: 'Readiness score',
      description: 'Pass rate 35%, execution 25%, requirement coverage 20%, open bugs 20%',
      max: 100,
      unit: '%',
      series: ready.parts.map((p) => ({
        label: {
          passRate: 'Pass rate',
          executionComplete: 'Execution',
          requirementCoverage: 'Requirement coverage',
          bugs: 'Open bugs',
        }[p.key]!,
        value: Math.round(p.value),
        tone: toneForRate(p.value, 90, 70),
      })),
    },
    {
      kind: 'table',
      title: 'Open bugs',
      columns: [
        { key: 'bug', label: 'Bug' },
        { key: 'title', label: 'Title' },
        { key: 'severity', label: 'Severity' },
        { key: 'status', label: 'Status' },
      ],
      ...cap(
        bugs
          .sort(
            (a, b) =>
              BUG_SEVERITIES.indexOf(a.severity as never) -
              BUG_SEVERITIES.indexOf(b.severity as never),
          )
          .map((b) => ({
            bug: formatRef('bug', b.seq),
            title: b.title,
            severity: {
              text: b.severity.toLowerCase(),
              tone:
                b.severity === 'BLOCKER' || b.severity === 'CRITICAL'
                  ? 'bad'
                  : b.severity === 'MAJOR'
                    ? 'warn'
                    : 'neutral',
            },
            status: status(b.status),
          })),
      ),
      empty: 'No open bugs.',
    },
    {
      kind: 'table',
      title: 'Requirements in scope',
      columns: [
        { key: 'req', label: 'Requirement' },
        { key: 'title', label: 'Title' },
        { key: 'priority', label: 'Priority' },
        { key: 'tests', label: 'Tests', align: 'right' },
        { key: 'state', label: 'Verified' },
      ],
      ...cap(
        scope.map((i) => {
          const q = i.requirement!;
          const st = q.testCases.flatMap((t) => byCase.get(t.testCaseId) ?? []);
          return {
            req: formatRef('requirement', q.seq),
            title: q.title,
            priority: q.priority.toLowerCase(),
            tests: q.testCases.length,
            state: !q.testCases.length
              ? { text: 'No tests', tone: 'bad' }
              : !st.length
                ? { text: 'Not run', tone: 'warn' }
                : st.every((s) => s === 'PASSED')
                  ? { text: 'Passed', tone: 'good' }
                  : { text: 'Failing', tone: 'bad' },
          };
        }),
      ),
      empty: 'No requirements in scope.',
    },
    {
      kind: 'table',
      title: 'Sign-off',
      columns: [
        { key: 'who', label: 'Approver' },
        { key: 'role', label: 'Role' },
        { key: 'decision', label: 'Decision' },
        { key: 'when', label: 'Date' },
        { key: 'comment', label: 'Comment' },
      ],
      rows: approvals.map((a) => ({
        who: a.approver.name,
        role: a.roleLabel,
        decision:
          a.status === 'APPROVED'
            ? { text: 'Approved', tone: 'good' }
            : a.status === 'REJECTED'
              ? { text: 'Rejected', tone: 'bad' }
              : { text: 'Pending', tone: 'neutral' },
        when: a.decidedAt ? day(a.decidedAt) : '—',
        comment: a.comment,
      })),
      empty: 'No approvers named yet.',
    },
  ];
  const head = await header(
    ctx,
    'GO_NO_GO',
    `${formatRef('release', release.seq)} ${release.name} (${release.version})`,
  );
  const c = metrics.counts;
  return {
    ...head,
    verdict: { value: verdict, reason },
    kpis: [
      {
        label: 'Readiness',
        value: ready.score,
        unit: '/100',
        tone: ready.band === 'READY' ? 'good' : ready.band === 'AT_RISK' ? 'warn' : 'bad',
      },
      {
        label: 'Gates met',
        value: `${results.filter((g) => g.passed).length} of ${results.length}`,
        tone: failedGates.some((g) => g.blocking) ? 'bad' : failedGates.length ? 'warn' : 'good',
      },
      { label: 'Pass rate', value: pctText(metrics.passRate), tone: toneForRate(metrics.passRate) },
      { label: 'Executed', value: `${c.executed} of ${c.testCases}` },
      {
        label: 'Open blocker/critical bugs',
        value: metrics.openBugs.BLOCKER + metrics.openBugs.CRITICAL,
        tone: metrics.openBugs.BLOCKER + metrics.openBugs.CRITICAL ? 'bad' : 'good',
      },
      {
        label: 'Requirement coverage',
        value: pctText(metrics.requirementCoverage),
        tone: toneForRate(metrics.requirementCoverage, 90, 70),
      },
    ],
    sections,
  };
}

// ---- traceability ---------------------------------------------------------------------------------

export async function traceability(ctx: BuildContext): Promise<ReportDoc> {
  const db = ctx.db;
  const release = await releaseOf(ctx);
  const reqs = await db.requirement.findMany({
    where: {
      projectId: ctx.projectId,
      deletedAt: null,
      ...(release ? { releaseItems: { some: { releaseId: release.id } } } : {}),
    },
    orderBy: { seq: 'asc' },
    take: 2000,
    select: {
      seq: true,
      title: true,
      priority: true,
      testCases: {
        where: { testCase: { deletedAt: null } },
        orderBy: { testCase: { seq: 'asc' } },
        select: {
          testCase: {
            select: {
              id: true,
              seq: true,
              title: true,
              bugs: { select: { bug: { select: { seq: true, status: true, deletedAt: true } } } },
            },
          },
        },
      },
    },
  });
  const caseIds = [...new Set(reqs.flatMap((r) => r.testCases.map((t) => t.testCase.id)))];
  // Latest result per case: within the release runs, or across the whole project.
  const runIds = release
    ? (
        await db.testRun.findMany({
          where: { releaseId: release.id, deletedAt: null },
          select: { id: true },
        })
      ).map((r) => r.id)
    : null;
  const results = await db.testRunResult.findMany({
    where: {
      testCaseId: { in: caseIds },
      status: { not: 'UNTESTED' },
      ...(runIds
        ? { testRunId: { in: runIds } }
        : { testRun: { projectId: ctx.projectId, deletedAt: null } }),
    },
    orderBy: [{ executedAt: 'desc' }, { updatedAt: 'desc' }],
    select: {
      testCaseId: true,
      status: true,
      executedAt: true,
      testRun: { select: { seq: true } },
    },
  });
  const last = new Map<string, (typeof results)[number]>();
  for (const r of results) if (r.testCaseId && !last.has(r.testCaseId)) last.set(r.testCaseId, r);

  const rows: Record<string, ReturnType<typeof status> | string | number | null>[] = [];
  let covered = 0;
  let executedReqs = 0;
  let passingReqs = 0;
  const openBugIds = new Set<number>();
  for (const q of reqs) {
    if (!q.testCases.length) {
      rows.push({
        req: formatRef('requirement', q.seq),
        title: q.title,
        priority: q.priority.toLowerCase(),
        case: { text: 'No test cases', tone: 'bad' },
        caseTitle: '',
        result: '—',
        bugs: '—',
      });
      continue;
    }
    covered++;
    const sts = q.testCases.map((t) => last.get(t.testCase.id)?.status).filter(Boolean) as string[];
    if (sts.length) executedReqs++;
    if (sts.length === q.testCases.length && sts.every((s) => s === 'PASSED')) passingReqs++;
    q.testCases.forEach((t, i) => {
      const r = last.get(t.testCase.id);
      const bugs = t.testCase.bugs.map((b) => b.bug).filter((b) => !b.deletedAt);
      for (const b of bugs) if (isOpen(b.status)) openBugIds.add(b.seq);
      rows.push({
        req: i === 0 ? formatRef('requirement', q.seq) : '',
        title: i === 0 ? q.title : '',
        priority: i === 0 ? q.priority.toLowerCase() : '',
        case: formatRef('testCase', t.testCase.seq),
        caseTitle: t.testCase.title,
        result: r
          ? {
              ...status(r.status),
              text: `${status(r.status).text} (${formatRef('testRun', r.testRun.seq)})`,
            }
          : { text: 'Not run', tone: 'warn' },
        bugs:
          bugs
            .map((b) => formatRef('bug', b.seq) + (isOpen(b.status) ? '' : ' (closed)'))
            .join(', ') || '—',
      });
    });
  }
  const head = await header(
    ctx,
    'TRACEABILITY_MATRIX',
    release
      ? `${formatRef('release', release.seq)} ${release.name} (${release.version})`
      : 'All requirements in the project',
  );
  const cov = percentage(covered, reqs.length);
  return {
    ...head,
    kpis: [
      { label: 'Requirements', value: reqs.length },
      { label: 'With test cases', value: pctText(cov), tone: toneForRate(cov, 90, 70) },
      { label: 'Executed', value: `${executedReqs} of ${reqs.length}` },
      {
        label: 'All tests passing',
        value: `${passingReqs} of ${reqs.length}`,
        tone: passingReqs === reqs.length ? 'good' : 'warn',
      },
      { label: 'Open linked bugs', value: openBugIds.size, tone: openBugIds.size ? 'bad' : 'good' },
    ],
    sections: [
      {
        kind: 'table',
        title: 'Requirements → test cases → results → bugs',
        columns: [
          { key: 'req', label: 'Requirement' },
          { key: 'title', label: 'Title' },
          { key: 'priority', label: 'Priority' },
          { key: 'case', label: 'Test case' },
          { key: 'caseTitle', label: 'Test case title' },
          { key: 'result', label: 'Latest result' },
          { key: 'bugs', label: 'Bugs' },
        ],
        ...cap(rows),
        empty: 'No requirements yet.',
      },
    ],
  };
}

// ---- bug summary ---------------------------------------------------------------------------------

export async function bugSummary(ctx: BuildContext): Promise<ReportDoc> {
  const { from, to } = period(ctx);
  const release = await releaseOf(ctx);
  const runIds = release
    ? (
        await ctx.db.testRun.findMany({
          where: { releaseId: release.id, deletedAt: null },
          select: { id: true },
        })
      ).map((r) => r.id)
    : [];
  const all = release
    ? await releaseBugs(ctx.db, release.id, runIds)
    : await ctx.db.bug.findMany({
        where: { projectId: ctx.projectId, deletedAt: null },
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
      });
  const inRange = (d: Date | null) => !!d && d >= from && d <= to;
  const opened = all.filter((b) => inRange(b.createdAt));
  const closed = all.filter((b) => inRange(b.closedAt));
  const open = all.filter((b) => isOpen(b.status));
  const sevTone: Record<string, Tone> = {
    BLOCKER: 'bad',
    CRITICAL: 'bad',
    MAJOR: 'warn',
    MINOR: 'neutral',
    TRIVIAL: 'neutral',
  };
  const components = new Map<string, { open: number; opened: number; closed: number }>();
  const comp = (b: (typeof all)[number]) => {
    const k = b.component || 'No component';
    if (!components.has(k)) components.set(k, { open: 0, opened: 0, closed: 0 });
    return components.get(k)!;
  };
  for (const b of open) comp(b).open++;
  for (const b of opened) comp(b).opened++;
  for (const b of closed) comp(b).closed++;
  const statuses = [...new Set(open.map((b) => b.status))];
  const head = await header(
    ctx,
    'BUG_SUMMARY',
    `${day(from)} to ${day(to)}${release ? ` · ${formatRef('release', release.seq)} ${release.name}` : ''}`,
  );
  const critical = open.filter((b) => b.severity === 'BLOCKER' || b.severity === 'CRITICAL');
  return {
    ...head,
    period: { from: day(from), to: day(to) },
    kpis: [
      { label: 'Open now', value: open.length, tone: open.length ? 'warn' : 'good' },
      { label: 'Opened in period', value: opened.length },
      {
        label: 'Closed in period',
        value: closed.length,
        tone: closed.length >= opened.length ? 'good' : 'warn',
      },
      {
        label: 'Open blocker/critical',
        value: critical.length,
        tone: critical.length ? 'bad' : 'good',
      },
    ],
    sections: [
      {
        kind: 'bars',
        title: 'Open bugs by severity',
        series: BUG_SEVERITIES.map((s) => ({
          label: s.charAt(0) + s.slice(1).toLowerCase(),
          value: open.filter((b) => b.severity === s).length,
          tone: sevTone[s],
        })),
      },
      {
        kind: 'bars',
        title: 'Open bugs by status',
        series: statuses.map((s) => ({
          label: status(s).text,
          value: open.filter((b) => b.status === s).length,
        })),
      },
      {
        kind: 'table',
        title: 'By component',
        columns: [
          { key: 'component', label: 'Component' },
          { key: 'open', label: 'Open now', align: 'right' },
          { key: 'opened', label: 'Opened', align: 'right' },
          { key: 'closed', label: 'Closed', align: 'right' },
        ],
        rows: [...components.entries()]
          .sort((a, b) => b[1].open - a[1].open || a[0].localeCompare(b[0]))
          .map(([component, v]) => ({ component, ...v })),
        empty: 'No bugs.',
      },
      {
        kind: 'table',
        title: 'Open blocker and critical bugs',
        columns: [
          { key: 'bug', label: 'Bug' },
          { key: 'title', label: 'Title' },
          { key: 'severity', label: 'Severity' },
          { key: 'status', label: 'Status' },
          { key: 'age', label: 'Age (days)', align: 'right' },
        ],
        ...cap(
          critical.map((b) => ({
            bug: formatRef('bug', b.seq),
            title: b.title,
            severity: { text: b.severity.toLowerCase(), tone: 'bad' as Tone },
            status: status(b.status),
            age: Math.floor(((ctx.now ?? new Date()).getTime() - b.createdAt.getTime()) / DAY),
          })),
        ),
        empty: 'None.',
      },
    ],
  };
}

// ---- sprint summary -----------------------------------------------------------------------------------

export async function sprintSummary(ctx: BuildContext): Promise<ReportDoc> {
  const { from, to } = period(ctx);
  const db = ctx.db;
  const range = { gte: from, lte: to };
  const [results, runs, bugsOpened, bugsClosed, casesCreated, reqsCreated] = await Promise.all([
    db.testRunResult.findMany({
      where: { executedAt: range, testRun: { projectId: ctx.projectId, deletedAt: null } },
      select: { status: true, testCaseId: true, testCase: { select: { seq: true, title: true } } },
    }),
    db.testRun.findMany({
      where: {
        projectId: ctx.projectId,
        deletedAt: null,
        OR: [
          { createdAt: range },
          { completedAt: range },
          { results: { some: { executedAt: range } } },
        ],
      },
      select: { seq: true, name: true, status: true, _count: { select: { results: true } } },
      orderBy: { seq: 'asc' },
    }),
    db.bug.count({ where: { projectId: ctx.projectId, deletedAt: null, createdAt: range } }),
    db.bug.count({ where: { projectId: ctx.projectId, deletedAt: null, closedAt: range } }),
    db.testCase.count({ where: { projectId: ctx.projectId, deletedAt: null, createdAt: range } }),
    db.requirement.count({
      where: { projectId: ctx.projectId, deletedAt: null, createdAt: range },
    }),
  ]);
  const passed = results.filter((r) => r.status === 'PASSED').length;
  const failedResults = results.filter((r) => r.status === 'FAILED');
  const pr = percentage(passed, results.length);
  const failing = new Map<string, { ref: string; title: string; failures: number }>();
  for (const r of failedResults) {
    if (!r.testCase || !r.testCaseId) continue;
    const f = failing.get(r.testCaseId) ?? {
      ref: formatRef('testCase', r.testCase.seq),
      title: r.testCase.title,
      failures: 0,
    };
    f.failures++;
    failing.set(r.testCaseId, f);
  }
  const head = await header(ctx, 'SPRINT_SUMMARY', `${day(from)} to ${day(to)}`);
  return {
    ...head,
    period: { from: day(from), to: day(to) },
    kpis: [
      { label: 'Results recorded', value: results.length },
      { label: 'Pass rate', value: pctText(pr), tone: toneForRate(pr) },
      { label: 'Bugs opened', value: bugsOpened },
      { label: 'Bugs closed', value: bugsClosed, tone: bugsClosed >= bugsOpened ? 'good' : 'warn' },
      { label: 'Test cases written', value: casesCreated },
      { label: 'Requirements added', value: reqsCreated },
    ],
    sections: [
      {
        kind: 'bars',
        title: 'Results recorded in the period',
        series: (['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'] as const).map((s) => ({
          label: status(s).text,
          value: results.filter((r) => r.status === s).length,
          tone: STATUS_TONE[s],
        })),
      },
      {
        kind: 'table',
        title: 'Test runs active in the period',
        columns: [
          { key: 'run', label: 'Run' },
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status' },
          { key: 'cases', label: 'Cases', align: 'right' },
        ],
        ...cap(
          runs.map((r) => ({
            run: formatRef('testRun', r.seq),
            name: r.name,
            status: status(r.status),
            cases: r._count.results,
          })),
        ),
        empty: 'No test runs in this period.',
      },
      {
        kind: 'table',
        title: 'Most failing test cases',
        columns: [
          { key: 'ref', label: 'Case' },
          { key: 'title', label: 'Title' },
          { key: 'failures', label: 'Failures', align: 'right' },
        ],
        rows: [...failing.values()]
          .sort((a, b) => b.failures - a.failures || a.ref.localeCompare(b.ref))
          .slice(0, 15),
        empty: 'No failures in this period.',
      },
    ],
  };
}

// ---- automation trend ------------------------------------------------------------------------------------

export async function automationTrend(ctx: BuildContext): Promise<ReportDoc> {
  const { from, to } = period(ctx);
  const db = ctx.db;
  const range = { gte: from, lte: to };
  const [runs, results, flaky] = await Promise.all([
    db.automationRun.findMany({
      where: {
        projectId: ctx.projectId,
        createdAt: range,
        status: { in: ['PASSED', 'FAILED', 'ERROR'] },
      },
      select: { createdAt: true, totals: true, status: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.automationResult.findMany({
      where: { automationRun: { projectId: ctx.projectId, createdAt: range } },
      select: {
        name: true,
        status: true,
        flaky: true,
        durationMs: true,
        failureClass: true,
        automationTestId: true,
      },
    }),
    db.automationTest.findMany({
      where: { projectId: ctx.projectId, deletedAt: null, flakyScore: { gt: 0 } },
      orderBy: { flakyScore: 'desc' },
      take: 20,
      select: { path: true, flakyScore: true, status: true },
    }),
  ]);
  type Totals = { total?: number; passed?: number; durationMs?: number };
  const byDay = new Map<string, { passed: number; total: number }>();
  for (const r of runs) {
    const t = (r.totals ?? {}) as Totals;
    const d = byDay.get(day(r.createdAt)) ?? { passed: 0, total: 0 };
    d.passed += t.passed ?? 0;
    d.total += t.total ?? 0;
    byDay.set(day(r.createdAt), d);
  }
  const totalPassed = results.filter((r) => r.status === 'PASSED').length;
  const pr = percentage(totalPassed, results.length);
  const durations = runs
    .map((r) => ((r.totals ?? {}) as Totals).durationMs)
    .filter((d): d is number => typeof d === 'number');
  const avgMin = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 6000) / 10
    : null;
  const classes = ['PRODUCT_BUG', 'TEST_BUG', 'FLAKY', 'ENVIRONMENT'] as const;
  const slow = new Map<string, { total: number; n: number }>();
  for (const r of results) {
    if (r.durationMs === null) continue;
    const s = slow.get(r.name) ?? { total: 0, n: 0 };
    s.total += r.durationMs;
    s.n++;
    slow.set(r.name, s);
  }
  const head = await header(ctx, 'AUTOMATION_TREND', `${day(from)} to ${day(to)}`);
  return {
    ...head,
    period: { from: day(from), to: day(to) },
    kpis: [
      { label: 'Automation runs', value: runs.length },
      { label: 'Pass rate', value: pctText(pr), tone: toneForRate(pr) },
      {
        label: 'Flaky results',
        value: results.filter((r) => r.flaky).length,
        tone: results.some((r) => r.flaky) ? 'warn' : 'good',
      },
      { label: 'Average run time', value: avgMin === null ? '—' : `${avgMin} min` },
      { label: 'Failures', value: results.filter((r) => r.status === 'FAILED').length },
    ],
    sections: [
      {
        kind: 'bars',
        title: 'Pass rate by day',
        unit: '%',
        max: 100,
        series: [...byDay.entries()].map(([label, d]) => {
          const v = percentage(d.passed, d.total) ?? 0;
          return { label, value: v, tone: toneForRate(v) };
        }),
      },
      {
        kind: 'bars',
        title: 'Failure causes (AI analysis)',
        series: classes.map((c) => ({
          label: {
            PRODUCT_BUG: 'Product bug',
            TEST_BUG: 'Test problem',
            FLAKY: 'Flaky',
            ENVIRONMENT: 'Environment',
          }[c],
          value: results.filter((r) => r.failureClass === c).length,
          tone: c === 'PRODUCT_BUG' ? 'bad' : 'warn',
        })),
      },
      {
        kind: 'table',
        title: 'Flakiest tests',
        description: 'Share of the last 10 results that passed only on retry',
        columns: [
          { key: 'path', label: 'Test' },
          { key: 'score', label: 'Flaky score', align: 'right' },
          { key: 'status', label: 'Status' },
        ],
        rows: flaky.map((t) => ({
          path: t.path,
          score: Math.round(t.flakyScore * 100) / 100,
          status: status(t.status),
        })),
        empty: 'No flaky tests.',
      },
      {
        kind: 'table',
        title: 'Slowest tests',
        columns: [
          { key: 'name', label: 'Test or request' },
          { key: 'avg', label: 'Average (s)', align: 'right' },
          { key: 'runs', label: 'Runs', align: 'right' },
        ],
        rows: [...slow.entries()]
          .map(([name, s]) => ({ name, avg: Math.round(s.total / s.n / 100) / 10, runs: s.n }))
          .sort((a, b) => b.avg - a.avg || a.name.localeCompare(b.name))
          .slice(0, 10),
        empty: 'No automation results in this period.',
      },
    ],
  };
}

const BUILDERS: Record<ReportType, (ctx: BuildContext) => Promise<ReportDoc>> = {
  TEST_EXECUTION: testExecution,
  GO_NO_GO: goNoGo,
  TRACEABILITY_MATRIX: traceability,
  BUG_SUMMARY: bugSummary,
  SPRINT_SUMMARY: sprintSummary,
  AUTOMATION_TREND: automationTrend,
};

export function buildReport(type: ReportType, ctx: BuildContext): Promise<ReportDoc> {
  return BUILDERS[type](ctx);
}

export type { ReportKpi };
