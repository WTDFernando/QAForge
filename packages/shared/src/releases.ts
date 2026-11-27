import { z } from 'zod';
import { BUG_SEVERITIES } from './bugs';
import { PRIORITIES } from './qa';
import { patchOf } from './zod-utils';

// ---- releases --------------------------------------------------------------------------------

export const RELEASE_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'RELEASED',
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const releaseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  version: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[\w.+-]+$/, 'Use letters, numbers, dots, dashes, e.g. 2.4.0'),
  description: z.string().max(10_000).default(''),
  targetDate: z.coerce.date().nullable().optional(),
});
export const updateReleaseSchema = patchOf(releaseSchema);
export type ReleaseInput = z.infer<typeof releaseSchema>;

const ids = z.array(z.uuid()).max(500).default([]);
/** Add or remove scope: requirements and bugs are release items; test runs are linked to the release. */
export const releaseScopeSchema = z.object({
  add: z.object({ requirementIds: ids, bugIds: ids, testRunIds: ids }).default({
    requirementIds: [],
    bugIds: [],
    testRunIds: [],
  }),
  remove: z.object({ requirementIds: ids, bugIds: ids, testRunIds: ids }).default({
    requirementIds: [],
    bugIds: [],
    testRunIds: [],
  }),
});
export type ReleaseScopeInput = z.infer<typeof releaseScopeSchema>;

// ---- quality gates ------------------------------------------------------------------------------

export const GATE_METRICS = [
  'PASS_RATE',
  'EXECUTION_COMPLETE',
  'OPEN_BUGS',
  'REQUIREMENT_COVERAGE',
  'HIGH_PRIORITY_COVERAGE',
  'AUTOMATION_PASS_RATE',
] as const;
export type GateMetric = (typeof GATE_METRICS)[number];
export const GATE_OPERATORS = ['GTE', 'LTE', 'EQ'] as const;
export type GateOperator = (typeof GATE_OPERATORS)[number];

/** How each metric is measured; percentages are 0-100. */
export const GATE_METRIC_INFO: Record<
  GateMetric,
  { label: string; unit: '%' | 'bugs'; description: string }
> = {
  PASS_RATE: {
    label: 'Pass rate',
    unit: '%',
    description: 'Passed ÷ executed, using the latest result of each test case in the release runs',
  },
  EXECUTION_COMPLETE: {
    label: 'Execution complete',
    unit: '%',
    description: 'Test cases with a result ÷ all test cases in the release runs',
  },
  OPEN_BUGS: {
    label: 'Open bugs',
    unit: 'bugs',
    description: 'Unresolved bugs in scope or found in the release runs (optionally by severity)',
  },
  REQUIREMENT_COVERAGE: {
    label: 'Requirement coverage',
    unit: '%',
    description: 'Requirements in scope with at least one linked test case executed in the release',
  },
  HIGH_PRIORITY_COVERAGE: {
    label: 'High-priority requirements passed',
    unit: '%',
    description: 'High and critical requirements in scope whose executed test cases all passed',
  },
  AUTOMATION_PASS_RATE: {
    label: 'Automation pass rate',
    unit: '%',
    description: 'Passed ÷ executed in automated test runs linked to the release',
  },
};

export const gateSchema = z.object({
  metric: z.enum(GATE_METRICS),
  operator: z.enum(GATE_OPERATORS),
  threshold: z.number().min(0).max(100_000),
  params: z
    .object({
      severities: z.array(z.enum(BUG_SEVERITIES)).max(5).optional(),
      priorities: z.array(z.enum(PRIORITIES)).max(4).optional(),
    })
    .default({}),
  blocking: z.boolean().default(true),
});
export type GateInput = z.infer<typeof gateSchema>;
export const setGatesSchema = z.object({ gates: z.array(gateSchema).max(20) });

/** Sensible defaults for a new release. */
export const DEFAULT_GATES: GateInput[] = [
  { metric: 'EXECUTION_COMPLETE', operator: 'GTE', threshold: 100, params: {}, blocking: true },
  { metric: 'PASS_RATE', operator: 'GTE', threshold: 95, params: {}, blocking: true },
  {
    metric: 'OPEN_BUGS',
    operator: 'LTE',
    threshold: 0,
    params: { severities: ['BLOCKER', 'CRITICAL'] },
    blocking: true,
  },
  { metric: 'REQUIREMENT_COVERAGE', operator: 'GTE', threshold: 90, params: {}, blocking: false },
];

/** Numbers measured for a release (null = nothing to measure yet, e.g. no runs). */
export interface ReleaseMetrics {
  passRate: number | null;
  executionComplete: number | null;
  /** Open bugs by severity */
  openBugs: Record<(typeof BUG_SEVERITIES)[number], number>;
  requirementCoverage: number | null;
  /** Coverage of requirements by priority, for HIGH_PRIORITY_COVERAGE with custom priorities */
  priorityCoverage: Record<(typeof PRIORITIES)[number], { total: number; passed: number }>;
  automationPassRate: number | null;
  counts: {
    testCases: number;
    executed: number;
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
    requirements: number;
    requirementsCovered: number;
    testRuns: number;
    automatedExecuted: number;
    automatedPassed: number;
  };
}

export interface GateResult {
  metric: GateMetric;
  operator: GateOperator;
  threshold: number;
  params: GateInput['params'];
  blocking: boolean;
  /** Measured value; null when there is no data yet */
  actual: number | null;
  passed: boolean;
}

const pct = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 1000) / 10 : null;
export { pct as percentage };

export function metricValue(m: ReleaseMetrics, gate: Pick<GateInput, 'metric' | 'params'>) {
  switch (gate.metric) {
    case 'PASS_RATE':
      return m.passRate;
    case 'EXECUTION_COMPLETE':
      return m.executionComplete;
    case 'OPEN_BUGS': {
      const sev: readonly (typeof BUG_SEVERITIES)[number][] = gate.params.severities?.length
        ? gate.params.severities
        : BUG_SEVERITIES;
      let n = 0;
      for (const s of sev) n += m.openBugs[s] ?? 0;
      return n;
    }
    case 'REQUIREMENT_COVERAGE':
      return m.requirementCoverage;
    case 'HIGH_PRIORITY_COVERAGE': {
      const pr = gate.params.priorities?.length
        ? gate.params.priorities
        : (['HIGH', 'CRITICAL'] as const);
      const t = pr.reduce<{ total: number; passed: number }>(
        (a, p) => ({
          total: a.total + (m.priorityCoverage[p]?.total ?? 0),
          passed: a.passed + (m.priorityCoverage[p]?.passed ?? 0),
        }),
        { total: 0, passed: 0 },
      );
      return pct(t.passed, t.total);
    }
    case 'AUTOMATION_PASS_RATE':
      return m.automationPassRate;
  }
}

/** A gate with no data fails, except OPEN_BUGS (zero bugs is a real value). */
export function evaluateGate(m: ReleaseMetrics, gate: GateInput): GateResult {
  const actual = metricValue(m, gate);
  const passed =
    actual !== null &&
    (gate.operator === 'GTE'
      ? actual >= gate.threshold
      : gate.operator === 'LTE'
        ? actual <= gate.threshold
        : actual === gate.threshold);
  return { ...gate, actual, passed };
}

export type ReadinessBand = 'READY' | 'AT_RISK' | 'NOT_READY' | 'BLOCKED';

/**
 * Readiness score 0-100: pass rate 35%, execution 25%, requirement coverage 20%, bugs 20%
 * (100, minus 25 per open blocker/critical and 5 per open major). Missing numbers count as 0.
 * The band is BLOCKED whenever a blocking gate fails, whatever the score.
 */
export function readiness(m: ReleaseMetrics, gates: GateResult[]) {
  const bugScore = Math.max(
    0,
    100 - 25 * (m.openBugs.BLOCKER + m.openBugs.CRITICAL) - 5 * m.openBugs.MAJOR,
  );
  const parts = [
    { key: 'passRate', weight: 0.35, value: m.passRate ?? 0 },
    { key: 'executionComplete', weight: 0.25, value: m.executionComplete ?? 0 },
    { key: 'requirementCoverage', weight: 0.2, value: m.requirementCoverage ?? 0 },
    { key: 'bugs', weight: 0.2, value: bugScore },
  ];
  const score = Math.round(parts.reduce((a, p) => a + p.weight * p.value, 0));
  const blockingFailed = gates.filter((g) => g.blocking && !g.passed);
  const band: ReadinessBand = blockingFailed.length
    ? 'BLOCKED'
    : score >= 85
      ? 'READY'
      : score >= 70
        ? 'AT_RISK'
        : 'NOT_READY';
  return { score, band, parts, blockingFailed: blockingFailed.length };
}

// ---- approvals -----------------------------------------------------------------------------------

export const approversSchema = z.object({
  approvers: z
    .array(
      z.object({
        userId: z.uuid(),
        roleLabel: z.string().trim().min(1).max(60),
      }),
    )
    .max(10),
});
export const approvalDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    comment: z.string().trim().max(5000).default(''),
  })
  .refine((d) => d.decision === 'APPROVED' || d.comment.length > 0, {
    message: 'Say why you are rejecting the release',
    path: ['comment'],
  });
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;

// ---- reports --------------------------------------------------------------------------------------

export const REPORT_TYPES = [
  'TEST_EXECUTION',
  'GO_NO_GO',
  'TRACEABILITY_MATRIX',
  'BUG_SUMMARY',
  'SPRINT_SUMMARY',
  'AUTOMATION_TREND',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TYPE_INFO: Record<
  ReportType,
  { label: string; description: string; needs: 'release' | 'runs' | 'period' | 'any' }
> = {
  TEST_EXECUTION: {
    label: 'Test execution',
    description: 'Results of one or more test runs, by status, suite and tester, with failures',
    needs: 'runs',
  },
  GO_NO_GO: {
    label: 'Go / No-Go',
    description: 'Release readiness: gates, score, open risks and sign-offs',
    needs: 'release',
  },
  TRACEABILITY_MATRIX: {
    label: 'Traceability matrix',
    description: 'Requirements → test cases → latest results → bugs',
    needs: 'any',
  },
  BUG_SUMMARY: {
    label: 'Bug summary',
    description: 'Bugs by severity, status and component; opened vs closed over the period',
    needs: 'period',
  },
  SPRINT_SUMMARY: {
    label: 'Sprint summary',
    description: 'What was tested, found and fixed in a date range',
    needs: 'period',
  },
  AUTOMATION_TREND: {
    label: 'Automation trend',
    description: 'Automation runs over time: pass rate, flaky tests, duration, failure causes',
    needs: 'period',
  },
};

export const reportParamsSchema = z
  .object({
    releaseId: z.uuid().optional(),
    testRunIds: z.array(z.uuid()).max(50).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((p) => !p.from || !p.to || p.from <= p.to, {
    message: 'The start date must be before the end date',
    path: ['to'],
  });
export type ReportParams = z.infer<typeof reportParamsSchema>;

export const createReportSchema = z
  .object({
    type: z.enum(REPORT_TYPES),
    title: z.string().trim().max(200).optional(),
    params: reportParamsSchema.default({}),
    /** Ask the Report Agent for a written summary (only when AI is on) */
    narrative: z.boolean().default(false),
  })
  .superRefine((r, ctx) => {
    const need = REPORT_TYPE_INFO[r.type].needs;
    if (need === 'release' && !r.params.releaseId)
      ctx.addIssue({ code: 'custom', message: 'Choose a release', path: ['params', 'releaseId'] });
    if (need === 'runs' && !r.params.releaseId && !r.params.testRunIds?.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Choose test runs or a release',
        path: ['params', 'testRunIds'],
      });
  });
export type CreateReportInput = z.infer<typeof createReportSchema>;

export const EXPORT_FORMATS = ['pdf', 'docx', 'xlsx', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const shareReportSchema = z.object({
  expiresInDays: z.number().int().min(1).max(90).default(14),
});

export const reportScheduleSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(REPORT_TYPES),
  /** Period reports cover the time since the previous run (or the last 7 days) */
  params: z.object({ releaseId: z.uuid().optional() }).default({}),
  cron: z
    .string()
    .trim()
    .regex(/^(\S+\s+){4}\S+$/, 'Use 5 fields: minute hour day month weekday'),
  timezone: z.string().trim().max(60).default('UTC'),
  formats: z
    .array(z.enum(['pdf', 'docx', 'xlsx', 'csv']))
    .min(1)
    .max(4)
    .default(['pdf']),
  recipients: z.array(z.email().max(200)).min(1).max(20),
  enabled: z.boolean().default(true),
});
export const updateReportScheduleSchema = patchOf(reportScheduleSchema);
export type ReportScheduleInput = z.infer<typeof reportScheduleSchema>;

export interface ReportJob {
  kind: 'generate' | 'export' | 'tick';
  reportId?: string;
}
