import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStorage, getPrisma } from '@qaforge/db';
import type { ReportDoc, ReportTable } from '@qaforge/shared';
import type { MailMessage } from './mailer';
import { exportReport, generateReport, reportScheduleTick } from './processor';

const prisma = getPrisma();
let projectId: string;
let userId: string;
let releaseId: string;
let runId: string;
const NOW = new Date('2026-11-27T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

beforeAll(async () => {
  const stamp = Date.now();
  userId = (
    await prisma.user.create({ data: { name: 'Rita Reporter', email: `rep${stamp}@test.dev` } })
  ).id;
  const orgId = (await prisma.organization.create({ data: { name: 'R', slug: `r-${stamp}` } })).id;
  await prisma.membership.create({ data: { organizationId: orgId, userId, role: 'QA_LEAD' } });
  projectId = (
    await prisma.project.create({
      data: { organizationId: orgId, name: 'Payments', key: 'PAY', createdById: userId },
    })
  ).id;
  const who = { projectId, createdById: userId, updatedById: userId };
  const suite = await prisma.testSuite.create({
    data: { projectId, name: 'Checkout', createdById: userId },
  });
  const reqs = await Promise.all([
    prisma.requirement.create({ data: { ...who, seq: 1, title: 'Pay by card', priority: 'HIGH' } }),
    prisma.requirement.create({ data: { ...who, seq: 2, title: 'Refunds', priority: 'MEDIUM' } }),
    prisma.requirement.create({
      data: { ...who, seq: 3, title: 'Untested idea', priority: 'LOW' },
    }),
  ]);
  const cases = await Promise.all(
    [1, 2, 3, 4].map((seq) =>
      prisma.testCase.create({
        data: {
          ...who,
          seq,
          title: `Case ${seq}`,
          suiteId: seq < 3 ? suite.id : null,
          createdAt: daysAgo(3),
        },
      }),
    ),
  );
  await prisma.requirementTestCase.createMany({
    data: [
      { requirementId: reqs[0].id, testCaseId: cases[0]!.id, createdById: userId },
      { requirementId: reqs[0].id, testCaseId: cases[1]!.id, createdById: userId },
      { requirementId: reqs[1].id, testCaseId: cases[2]!.id, createdById: userId },
    ],
  });
  const release = await prisma.release.create({
    data: {
      ...who,
      seq: 1,
      name: 'Spring',
      version: '2.4.0',
      items: { create: reqs.map((r) => ({ requirementId: r.id, createdById: userId })) },
      gates: {
        create: [
          { metric: 'PASS_RATE', operator: 'GTE', threshold: 90, position: 0 },
          {
            metric: 'OPEN_BUGS',
            operator: 'LTE',
            threshold: 0,
            params: { severities: ['CRITICAL'] },
            position: 1,
          },
        ],
      },
      approvals: { create: { approverId: userId, roleLabel: 'QA Lead' } },
    },
  });
  releaseId = release.id;
  const run = await prisma.testRun.create({
    data: {
      ...who,
      seq: 1,
      name: 'Regression',
      releaseId,
      status: 'IN_PROGRESS',
      build: '2.4.0-rc1',
    },
  });
  runId = run.id;
  const statuses = ['PASSED', 'FAILED', 'PASSED', 'UNTESTED'] as const;
  const results = await Promise.all(
    cases.map((c, i) =>
      prisma.testRunResult.create({
        data: {
          testRunId: run.id,
          testCaseId: c.id,
          testCaseVersion: 1,
          snapshot: { title: c.title },
          position: i,
          status: statuses[i],
          notes: i === 1 ? 'Card declined' : '',
          executedById: statuses[i] === 'UNTESTED' ? null : userId,
          executedAt: statuses[i] === 'UNTESTED' ? null : daysAgo(1),
        },
      }),
    ),
  );
  await prisma.bug.create({
    data: {
      ...who,
      seq: 1,
      title: 'Valid card declined',
      severity: 'CRITICAL',
      component: 'Payments',
      testRunResultId: results[1]!.id,
      createdAt: daysAgo(1),
    },
  });
  await prisma.bug.create({
    data: {
      ...who,
      seq: 2,
      title: 'Old typo',
      severity: 'MINOR',
      status: 'CLOSED',
      resolution: 'FIXED',
      createdAt: daysAgo(30),
      closedAt: daysAgo(2),
    },
  });
  await prisma.testCaseBug.create({
    data: {
      testCaseId: cases[1]!.id,
      bugId: (await prisma.bug.findFirstOrThrow({ where: { projectId, seq: 1 } })).id,
      createdById: userId,
    },
  });
  // Automation history: two runs, one flaky result, one product bug.
  const test = await prisma.automationTest.create({
    data: { ...who, name: 'Checkout', path: 'checkout.spec.ts', code: '', flakyScore: 0.3 },
  });
  for (const [i, passed] of [
    [2, 1],
    [1, 2],
  ] as const) {
    const ar = await prisma.automationRun.create({
      data: {
        projectId,
        seq: i,
        trigger: 'MANUAL',
        selection: { kind: 'all' },
        status: passed === 2 ? 'PASSED' : 'FAILED',
        totals: { total: 2, passed, durationMs: 60_000 },
        createdAt: daysAgo(i),
      },
    });
    await prisma.automationResult.createMany({
      data: [
        {
          automationRunId: ar.id,
          automationTestId: test.id,
          name: 'checkout.spec.ts',
          status: 'PASSED',
          flaky: passed === 2,
          durationMs: 4000,
        },
        {
          automationRunId: ar.id,
          name: 'GET /health',
          status: passed === 2 ? 'PASSED' : 'FAILED',
          durationMs: 100,
          failureClass: passed === 2 ? null : 'PRODUCT_BUG',
        },
      ],
    });
  }
});
afterAll(async () => {
  await prisma.$disconnect();
});

const newReport = (type: string, params: object, extra: object = {}) =>
  prisma.report.create({
    data: { projectId, type: type as never, title: type, params, createdById: userId, ...extra },
  });
const table = (doc: ReportDoc, title: string) =>
  doc.sections.find((s) => s.title === title) as ReportTable;
const kpi = (doc: ReportDoc, label: string) => doc.kpis.find((k) => k.label === label)?.value;

describe('report builders (numbers from the database)', () => {
  it('go / no-go: gates, readiness, verdict, sign-off', async () => {
    const r = await newReport('GO_NO_GO', { releaseId });
    const { doc } = await generateReport(r.id, { now: () => NOW, sendMail: null });
    expect(doc.verdict).toMatchObject({
      value: 'NO_GO',
      reason: '2 blocking quality gates not met',
    });
    expect(kpi(doc, 'Pass rate')).toBe('66.7%');
    expect(kpi(doc, 'Executed')).toBe('3 of 4');
    expect(table(doc, 'Quality gates').rows.map((x) => x.actual)).toEqual(['66.7%', '1']);
    expect(
      table(doc, 'Requirements in scope').rows.map((x) => (x.state as { text: string }).text),
    ).toEqual(['Failing', 'Passed', 'No tests']);
    expect(table(doc, 'Sign-off').rows[0]).toMatchObject({ who: 'Rita Reporter', role: 'QA Lead' });
    const saved = await prisma.report.findUniqueOrThrow({ where: { id: r.id } });
    expect(saved.status).toBe('READY');
  });

  it('test execution: by run, suite, tester, failures', async () => {
    const r = await newReport('TEST_EXECUTION', { testRunIds: [runId] });
    const { doc } = await generateReport(r.id, { now: () => NOW, sendMail: null });
    expect(table(doc, 'Test runs').rows[0]).toMatchObject({
      run: 'RUN-0001',
      total: 4,
      executed: 3,
      failed: 1,
    });
    expect(table(doc, 'By suite').rows.map((x) => x.suite)).toEqual(['Checkout', 'No suite']);
    expect(table(doc, 'By tester').rows[0]).toMatchObject({ tester: 'Rita Reporter', executed: 3 });
    expect(table(doc, 'Failed and blocked').rows[0]).toMatchObject({
      case: 'TC-0002',
      notes: 'Card declined',
      bugs: 'BUG-0001',
    });
  });

  it('traceability: requirement → case → result → bug', async () => {
    const r = await newReport('TRACEABILITY_MATRIX', { releaseId });
    const { doc } = await generateReport(r.id, { now: () => NOW, sendMail: null });
    const rows = doc.sections[0] as ReportTable;
    expect(rows.rows).toHaveLength(4); // 2 cases + 1 case + "no test cases"
    expect(rows.rows[1]).toMatchObject({ case: 'TC-0002', bugs: 'BUG-0001' });
    expect(kpi(doc, 'Open linked bugs')).toBe(1);
  });

  it('bug summary, sprint summary and automation trend over a period', async () => {
    const params = { from: daysAgo(7).toISOString(), to: NOW.toISOString() };
    const bugs = (
      await generateReport((await newReport('BUG_SUMMARY', params)).id, {
        now: () => NOW,
        sendMail: null,
      })
    ).doc;
    expect(kpi(bugs, 'Opened in period')).toBe(1);
    expect(kpi(bugs, 'Closed in period')).toBe(1);
    expect(table(bugs, 'By component').rows[0]).toMatchObject({ component: 'Payments', open: 1 });

    const sprint = (
      await generateReport((await newReport('SPRINT_SUMMARY', params)).id, {
        now: () => NOW,
        sendMail: null,
      })
    ).doc;
    expect(kpi(sprint, 'Results recorded')).toBe(3);
    expect(kpi(sprint, 'Test cases written')).toBe(4);
    expect(table(sprint, 'Most failing test cases').rows[0]).toMatchObject({
      ref: 'TC-0002',
      failures: 1,
    });

    const auto = (
      await generateReport((await newReport('AUTOMATION_TREND', params)).id, {
        now: () => NOW,
        sendMail: null,
      })
    ).doc;
    expect(kpi(auto, 'Automation runs')).toBe(2);
    expect(kpi(auto, 'Pass rate')).toBe('75%');
    expect(kpi(auto, 'Flaky results')).toBe(1);
    expect(table(auto, 'Flakiest tests').rows[0]).toMatchObject({
      path: 'checkout.spec.ts',
      score: 0.3,
    });
  });

  it('marks a report failed when it can’t be built', async () => {
    const r = await newReport('GO_NO_GO', { releaseId: '00000000-0000-4000-8000-000000000000' });
    await expect(generateReport(r.id, { sendMail: null })).rejects.toThrow('Release not found');
    expect((await prisma.report.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('FAILED');
  });
});

describe('exports, schedules and email', () => {
  it('stores PDF, DOCX, XLSX and CSV and replaces them on re-export', async () => {
    const r = await newReport('BUG_SUMMARY', {});
    await generateReport(r.id, { now: () => NOW, sendMail: null });
    const first = await prisma.attachment.findMany({
      where: { entityType: 'report', entityId: r.id },
    });
    expect(first.map((a) => a.fileName.split('.').pop()).sort()).toEqual([
      'csv',
      'docx',
      'pdf',
      'xlsx',
    ]);
    const xlsx = first.find((a) => a.fileName.endsWith('.xlsx'))!;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await createStorage().read(xlsx.storageKey)) as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.name).toBe('Summary');
    await prisma.report.update({
      where: { id: r.id },
      data: {
        narrative: {
          summary: 'One bug open.',
          highlights: [],
          risks: [],
          recommendation: 'Fix it.',
        },
      },
    });
    await exportReport(r.id, { sendMail: null });
    const second = await prisma.attachment.findMany({
      where: { entityType: 'report', entityId: r.id },
    });
    expect(second).toHaveLength(4);
    expect(second.some((a) => first.some((f) => f.id === a.id))).toBe(false);
  });

  it('a due schedule creates a period report and emails the chosen formats once', async () => {
    const s = await prisma.reportSchedule.create({
      data: {
        projectId,
        name: 'Weekly bugs',
        type: 'BUG_SUMMARY',
        cron: '0 8 * * 1',
        recipients: ['pm@example.com', 'lead@example.com'],
        formats: ['pdf', 'xlsx'],
        nextRunAt: daysAgo(0.01),
        createdById: userId,
      },
    });
    const queued: string[] = [];
    const ids = await reportScheduleTick(async (id) => queued.push(id), NOW);
    expect(ids).toHaveLength(1);
    expect(await reportScheduleTick(async () => undefined, NOW)).toHaveLength(0); // claimed
    const after = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(NOW.getTime());
    const report = await prisma.report.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(report.scheduleId).toBe(s.id);
    expect((report.params as { from: string }).from).toBe(daysAgo(7).toISOString());

    const sent: MailMessage[] = [];
    const sendMail = async (m: MailMessage) => void sent.push(m);
    await generateReport(ids[0]!, { now: () => NOW, sendMail });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(['pm@example.com', 'lead@example.com']);
    expect(sent[0]!.subject).toMatch(/^Bug summary: Payments/);
    expect(sent[0]!.attachments.map((a) => a.filename.split('.').pop())).toEqual(['pdf', 'xlsx']);
    // Re-exporting (e.g. when the AI narrative arrives) doesn't email again.
    await exportReport(ids[0]!, { sendMail });
    expect(sent).toHaveLength(1);
  });
});
