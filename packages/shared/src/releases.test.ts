import { describe, expect, it } from 'vitest';
import {
  approvalDecisionSchema,
  createReportSchema,
  DEFAULT_GATES,
  evaluateGate,
  hasPermission,
  readiness,
  type ReleaseMetrics,
} from './index';

const metrics = (over: Partial<ReleaseMetrics> = {}): ReleaseMetrics => ({
  passRate: 96,
  executionComplete: 100,
  openBugs: { BLOCKER: 0, CRITICAL: 0, MAJOR: 1, MINOR: 2, TRIVIAL: 0 },
  requirementCoverage: 92,
  priorityCoverage: {
    LOW: { total: 0, passed: 0 },
    MEDIUM: { total: 2, passed: 2 },
    HIGH: { total: 3, passed: 2 },
    CRITICAL: { total: 1, passed: 1 },
  },
  automationPassRate: null,
  counts: {
    testCases: 50,
    executed: 50,
    passed: 48,
    failed: 2,
    blocked: 0,
    skipped: 0,
    requirements: 12,
    requirementsCovered: 11,
    testRuns: 2,
    automatedExecuted: 0,
    automatedPassed: 0,
  },
  ...over,
});

describe('quality gates and readiness', () => {
  it('evaluates the default gates and scores a healthy release as ready', () => {
    const gates = DEFAULT_GATES.map((g) => evaluateGate(metrics(), g));
    expect(gates.every((g) => g.passed)).toBe(true);
    const r = readiness(metrics(), gates);
    expect(r.band).toBe('READY');
    // 0.35*96 + 0.25*100 + 0.2*92 + 0.2*95 = 96.0
    expect(r.score).toBe(96);
  });

  it('counts open bugs only for the chosen severities', () => {
    const m = metrics({ openBugs: { BLOCKER: 0, CRITICAL: 1, MAJOR: 3, MINOR: 0, TRIVIAL: 0 } });
    const critical = evaluateGate(m, DEFAULT_GATES[2]!);
    expect(critical).toMatchObject({ actual: 1, passed: false });
    expect(evaluateGate(m, { ...DEFAULT_GATES[2]!, params: {} }).actual).toBe(4);
  });

  it('blocks the release when a blocking gate fails, whatever the score', () => {
    const m = metrics({ passRate: 90 });
    const gates = DEFAULT_GATES.map((g) => evaluateGate(m, g));
    const r = readiness(m, gates);
    expect(r.blockingFailed).toBe(1);
    expect(r.band).toBe('BLOCKED');
  });

  it('fails percentage gates without data, but zero bugs is a pass', () => {
    const m = metrics({ passRate: null, executionComplete: null });
    expect(evaluateGate(m, DEFAULT_GATES[1]!)).toMatchObject({ actual: null, passed: false });
    expect(
      evaluateGate(metrics(), { ...DEFAULT_GATES[2]!, params: { severities: ['BLOCKER'] } }).passed,
    ).toBe(true);
  });

  it('measures high-priority coverage across the chosen priorities', () => {
    const g = evaluateGate(metrics(), {
      metric: 'HIGH_PRIORITY_COVERAGE',
      operator: 'GTE',
      threshold: 100,
      params: {},
      blocking: false,
    });
    expect(g).toMatchObject({ actual: 75, passed: false });
  });
});

describe('release and report contracts', () => {
  it('needs a reason to reject', () => {
    expect(approvalDecisionSchema.safeParse({ decision: 'REJECTED' }).success).toBe(false);
    expect(approvalDecisionSchema.safeParse({ decision: 'APPROVED' }).success).toBe(true);
  });

  it('checks that each report type has what it needs', () => {
    expect(createReportSchema.safeParse({ type: 'GO_NO_GO' }).success).toBe(false);
    expect(createReportSchema.safeParse({ type: 'TEST_EXECUTION' }).success).toBe(false);
    expect(createReportSchema.safeParse({ type: 'BUG_SUMMARY' }).success).toBe(true);
  });

  it('lets clients approve releases and read reports, but not share them', () => {
    expect(hasPermission('CLIENT', 'report:read')).toBe(true);
    expect(hasPermission('CLIENT', 'report:share')).toBe(false);
    expect(hasPermission('QA_LEAD', 'report:schedule')).toBe(true);
    expect(hasPermission('QA_ENGINEER', 'report:write')).toBe(true);
  });
});
