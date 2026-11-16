import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@qaforge/db';
import {
  EXECUTED_STATUSES,
  formatRef,
  hasPermission,
  passRate,
  RESULT_STATUSES,
  RUN_TRANSITIONS,
  type CreateTestRunInput,
  type RecordResultInput,
  type ResultStatus,
  type RunSelection,
  type UpdateTestRunInput,
} from '@qaforge/shared';
import { AuditService } from '../audit/audit.service';
import { nextSeq, type ProjectCtx } from '../common/project-scope';
import { NotificationsService } from '../notifications/notifications.module';
import { PrismaService } from '../prisma/prisma.module';
import { TestCasesService } from '../test-cases/test-cases.service';

type Tx = Prisma.TransactionClient;
const MAX_RESULTS_PER_RUN = 10000;

export interface RunCounts {
  total: number;
  byStatus: Record<ResultStatus, number>;
  executed: number;
  progressPct: number;
  passRate: number | null;
}

function counts(rows: { status: ResultStatus; _count: number }[]): RunCounts {
  const byStatus = Object.fromEntries(RESULT_STATUSES.map((s) => [s, 0])) as Record<
    ResultStatus,
    number
  >;
  for (const r of rows) byStatus[r.status] = r._count;
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const executed = EXECUTED_STATUSES.reduce((a, s) => a + byStatus[s], 0);
  return {
    total,
    byStatus,
    executed,
    progressPct: total ? Math.round((executed / total) * 100) : 0,
    passRate: passRate(byStatus),
  };
}

@Injectable()
export class TestRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly testCases: TestCasesService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- reading ---------------------------------------------------------

  private async countsFor(runIds: string[]) {
    if (!runIds.length) return new Map<string, RunCounts>();
    const grouped = await this.prisma.client.testRunResult.groupBy({
      by: ['testRunId', 'status'],
      where: { testRunId: { in: runIds } },
      _count: true,
    });
    const map = new Map<string, { status: ResultStatus; _count: number }[]>();
    for (const g of grouped)
      map.set(g.testRunId, [
        ...(map.get(g.testRunId) ?? []),
        { status: g.status, _count: g._count },
      ]);
    return new Map(runIds.map((id) => [id, counts(map.get(id) ?? [])]));
  }

  async list(
    projectId: string,
    q: { status?: string[]; q?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.TestRunWhereInput = {
      projectId,
      deletedAt: null,
      ...(q.status?.length ? { status: { in: q.status as never } } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { build: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.client.testRun.count({ where }),
      this.prisma.client.testRun.findMany({
        where,
        include: { environment: { select: { id: true, name: true } } },
        orderBy: { seq: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const c = await this.countsFor(rows.map((r) => r.id));
    return {
      items: rows.map((r) => ({ ...r, ref: formatRef('testRun', r.seq), counts: c.get(r.id)! })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async get(projectId: string, id: string) {
    const run = await this.prisma.client.testRun.findFirst({
      where: { id, projectId, deletedAt: null },
      include: { environment: { select: { id: true, name: true, baseUrl: true } } },
    });
    if (!run) throw new NotFoundException('Test run not found');
    const c = await this.countsFor([run.id]);
    return { ...run, ref: formatRef('testRun', run.seq), counts: c.get(run.id)! };
  }

  async getByRef(projectId: string, seq: number) {
    const run = await this.prisma.client.testRun.findFirst({
      where: { projectId, seq, deletedAt: null },
      select: { id: true },
    });
    if (!run) throw new NotFoundException('Test run not found');
    return this.get(projectId, run.id);
  }

  /** Lightweight rows for the execution sidebar (no full snapshot). */
  async results(
    projectId: string,
    runId: string,
    userId: string,
    q: { status?: ResultStatus[]; assigneeId?: string; q?: string },
  ) {
    await this.get(projectId, runId);
    const rows = await this.prisma.client.testRunResult.findMany({
      where: {
        testRunId: runId,
        ...(q.status?.length ? { status: { in: q.status } } : {}),
        ...(q.assigneeId === 'me'
          ? { assigneeId: userId }
          : q.assigneeId === 'none'
            ? { assigneeId: null }
            : q.assigneeId
              ? { assigneeId: q.assigneeId }
              : {}),
      },
      select: {
        id: true,
        testCaseId: true,
        position: true,
        status: true,
        assigneeId: true,
        dataRowIndex: true,
        executedAt: true,
        snapshot: true,
        _count: { select: { bugs: true } },
      },
      orderBy: { position: 'asc' },
    });
    const items = rows.map(({ snapshot, _count, ...r }) => {
      const s = snapshot as {
        ref: string;
        title: string;
        priority: string;
        testData?: { columns: string[]; rows: string[][] } | null;
      };
      const row = r.dataRowIndex !== null ? s.testData?.rows[r.dataRowIndex] : undefined;
      return {
        ...r,
        ref: s.ref,
        title: s.title,
        priority: s.priority,
        dataRow: row
          ? Object.fromEntries((s.testData?.columns ?? []).map((c, i) => [c, row[i] ?? '']))
          : null,
        bugCount: _count.bugs,
      };
    });
    const text = q.q?.trim().toLowerCase();
    return text
      ? items.filter(
          (i) => i.title.toLowerCase().includes(text) || i.ref.toLowerCase().includes(text),
        )
      : items;
  }

  async result(projectId: string, resultId: string) {
    const r = await this.prisma.client.testRunResult.findFirst({
      where: { id: resultId, testRun: { projectId, deletedAt: null } },
      include: {
        bugs: {
          where: { deletedAt: null },
          select: { id: true, seq: true, title: true, status: true, severity: true },
        },
      },
    });
    if (!r) throw new NotFoundException('Result not found');
    const attachments = await this.prisma.client.attachment.findMany({
      where: { entityType: 'test_run_result', entityId: resultId },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        size: true,
        scanStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return { ...r, bugs: r.bugs.map((b) => ({ ...b, ref: formatRef('bug', b.seq) })), attachments };
  }

  // ---- writing ---------------------------------------------------------

  private async assertMember(tx: Tx, organizationId: string, userId: string | null | undefined) {
    if (!userId) return;
    const m = await tx.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (!m) throw new BadRequestException('Assignee is not a member of this organization');
  }

  private async resolveCases(projectId: string, selection: RunSelection, onlyApproved: boolean) {
    let where: Prisma.TestCaseWhereInput;
    if (selection.kind === 'cases')
      where = { projectId, deletedAt: null, id: { in: selection.testCaseIds } };
    else if (selection.kind === 'suite')
      where = await this.testCases.buildWhere(projectId, {
        suiteId: selection.suiteId,
        deep: selection.deep,
      });
    else
      where = await this.testCases.buildWhere(projectId, {
        status: selection.status,
        priority: selection.priority,
        type: selection.type,
        tag: selection.tag,
        requirementId: selection.requirementId,
      });
    where = { AND: [where, { status: onlyApproved ? 'APPROVED' : { not: 'DEPRECATED' } }] };
    return this.prisma.client.testCase.findMany({
      where,
      include: { steps: { orderBy: { position: 'asc' }, include: { sharedStep: true } } },
      orderBy: [{ suiteId: 'asc' }, { seq: 'asc' }],
      take: MAX_RESULTS_PER_RUN + 1,
    });
  }

  /** Frozen copy of the case at run time (shared steps expanded). */
  private snapshotOf(tc: Awaited<ReturnType<TestRunsService['resolveCases']>>[number]) {
    const steps = tc.steps.flatMap((s) =>
      s.sharedStep
        ? (s.sharedStep.steps as { action: string; expected: string }[])
        : [{ action: s.action, expected: s.expected }],
    );
    return {
      ref: formatRef('testCase', tc.seq),
      title: tc.title,
      preconditions: tc.preconditions,
      steps,
      testData: tc.testData ?? null,
      priority: tc.priority,
      type: tc.type,
    };
  }

  private resultRows(
    cases: Awaited<ReturnType<TestRunsService['resolveCases']>>,
    runId: string,
    startPosition: number,
    assigneeId: string | null,
  ) {
    const rows: Prisma.TestRunResultCreateManyInput[] = [];
    for (const tc of cases) {
      const snapshot = this.snapshotOf(tc) as Prisma.InputJsonValue;
      const data = tc.testData as { rows?: string[][] } | null;
      const variants = data?.rows?.length ? data.rows.map((_, i) => i) : [null];
      for (const dataRowIndex of variants) {
        rows.push({
          testRunId: runId,
          testCaseId: tc.id,
          testCaseVersion: tc.version,
          snapshot,
          dataRowIndex,
          position: startPosition + rows.length,
          assigneeId,
        });
      }
    }
    return rows;
  }

  async create(ctx: ProjectCtx, input: CreateTestRunInput) {
    const cases = await this.resolveCases(ctx.projectId, input.selection, input.onlyApproved);
    if (cases.length === 0) throw new BadRequestException('No test cases match this selection');
    if (cases.length > MAX_RESULTS_PER_RUN)
      throw new BadRequestException(`A run can hold at most ${MAX_RESULTS_PER_RUN} test cases`);
    if (
      input.selection.kind === 'cases' &&
      cases.length !== new Set(input.selection.testCaseIds).size
    ) {
      throw new BadRequestException(
        'Some test cases were not found, are deprecated, or are not approved',
      );
    }
    const run = await this.prisma.client.$transaction(
      async (tx) => {
        if (input.environmentId) {
          const env = await tx.environment.findFirst({
            where: { id: input.environmentId, projectId: ctx.projectId },
          });
          if (!env) throw new BadRequestException('Environment not found in this project');
        }
        await this.assertMember(tx, ctx.organizationId, input.assigneeId);
        const seq = await nextSeq(tx, ctx.projectId, 'testRun');
        const run = await tx.testRun.create({
          data: {
            projectId: ctx.projectId,
            seq,
            name: input.name,
            description: input.description,
            source:
              input.selection.kind === 'cases'
                ? 'MANUAL'
                : input.selection.kind === 'suite'
                  ? 'SUITE'
                  : 'FILTER',
            sourceConfig: {
              ...input.selection,
              onlyApproved: input.onlyApproved,
            } as Prisma.InputJsonValue,
            environmentId: input.environmentId ?? null,
            build: input.build ?? null,
            dueAt: input.dueAt ? new Date(input.dueAt) : null,
            createdById: ctx.actor.id,
            updatedById: ctx.actor.id,
          },
        });
        const rows = this.resultRows(cases, run.id, 0, input.assigneeId ?? null);
        if (rows.length > MAX_RESULTS_PER_RUN)
          throw new BadRequestException(
            `This selection expands to ${rows.length} results (data rows); the limit is ${MAX_RESULTS_PER_RUN}`,
          );
        await tx.testRunResult.createMany({ data: rows });
        await this.audit.record(tx, ctx.actor, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          entityType: 'test_run',
          entityId: run.id,
          action: 'create',
          after: { ref: formatRef('testRun', seq), name: run.name },
          metadata: { results: rows.length, source: run.source },
        });
        if (input.assigneeId) {
          await this.notifications.notify(
            {
              organizationId: ctx.organizationId,
              projectId: ctx.projectId,
              userIds: [input.assigneeId],
              actorId: ctx.actor.id,
              type: 'run.assigned',
              title: `You were assigned ${rows.length} tests in ${formatRef('testRun', seq)}`,
              body: run.name,
              entityType: 'test_run',
              entityId: run.id,
            },
            tx,
          );
        }
        return run;
      },
      { timeout: 30_000 },
    );
    return this.get(ctx.projectId, run.id);
  }

  async update(ctx: ProjectCtx, id: string, input: UpdateTestRunInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.testRun.findFirst({
        where: { id, projectId: ctx.projectId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Test run not found');
      if (
        input.status &&
        input.status !== before.status &&
        !RUN_TRANSITIONS[before.status].includes(input.status)
      ) {
        throw new BadRequestException(`Cannot move a run from ${before.status} to ${input.status}`);
      }
      if (input.environmentId) {
        const env = await tx.environment.findFirst({
          where: { id: input.environmentId, projectId: ctx.projectId },
        });
        if (!env) throw new BadRequestException('Environment not found in this project');
      }
      const now = new Date();
      const data: Prisma.TestRunUncheckedUpdateInput = {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.environmentId !== undefined && { environmentId: input.environmentId }),
        ...(input.build !== undefined && { build: input.build }),
        ...(input.dueAt !== undefined && { dueAt: input.dueAt ? new Date(input.dueAt) : null }),
        ...(input.status !== undefined && {
          status: input.status,
          ...(input.status === 'IN_PROGRESS' && !before.startedAt && { startedAt: now }),
          ...(input.status === 'COMPLETED' && { completedAt: now }),
          ...(input.status === 'IN_PROGRESS' && { completedAt: null }),
        }),
        updatedById: ctx.actor.id,
      };
      const run = await tx.testRun.update({ where: { id }, data });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'test_run',
        entityId: id,
        action: input.status === 'COMPLETED' ? 'complete' : 'update',
        before,
        after: input,
      });
      return run;
    });
  }

  async remove(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const run = await tx.testRun.findFirst({
        where: { id, projectId: ctx.projectId, deletedAt: null },
      });
      if (!run) throw new NotFoundException('Test run not found');
      await tx.testRun.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'test_run',
        entityId: id,
        action: 'delete',
      });
    });
  }

  async addCases(ctx: ProjectCtx, runId: string, testCaseIds: string[]) {
    const cases = await this.resolveCases(ctx.projectId, { kind: 'cases', testCaseIds }, false);
    return this.prisma.client.$transaction(async (tx) => {
      const run = await tx.testRun.findFirst({
        where: { id: runId, projectId: ctx.projectId, deletedAt: null },
      });
      if (!run) throw new NotFoundException('Test run not found');
      const existing = new Set(
        (
          await tx.testRunResult.findMany({
            where: { testRunId: runId },
            select: { testCaseId: true },
          })
        ).map((r) => r.testCaseId),
      );
      const fresh = cases.filter((c) => !existing.has(c.id));
      const last = await tx.testRunResult.aggregate({
        where: { testRunId: runId },
        _max: { position: true },
      });
      const rows = this.resultRows(fresh, runId, (last._max.position ?? -1) + 1, null);
      await tx.testRunResult.createMany({ data: rows });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'test_run',
        entityId: runId,
        action: 'update',
        metadata: { addedResults: rows.length },
      });
      return { added: rows.length, skipped: cases.length - fresh.length };
    });
  }

  async assign(ctx: ProjectCtx, runId: string, resultIds: string[], assigneeId: string | null) {
    return this.prisma.client.$transaction(async (tx) => {
      const run = await tx.testRun.findFirst({
        where: { id: runId, projectId: ctx.projectId, deletedAt: null },
      });
      if (!run) throw new NotFoundException('Test run not found');
      await this.assertMember(tx, ctx.organizationId, assigneeId);
      const res = await tx.testRunResult.updateMany({
        where: { testRunId: runId, id: { in: resultIds } },
        data: { assigneeId },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'test_run',
        entityId: runId,
        action: 'assign',
        metadata: { assigneeId, results: res.count },
      });
      if (assigneeId) {
        await this.notifications.notify(
          {
            organizationId: ctx.organizationId,
            projectId: ctx.projectId,
            userIds: [assigneeId],
            actorId: ctx.actor.id,
            type: 'run.assigned',
            title: `You were assigned ${res.count} test${res.count === 1 ? '' : 's'} in ${formatRef('testRun', run.seq)}`,
            body: run.name,
            entityType: 'test_run',
            entityId: runId,
          },
          tx,
        );
      }
      return { updated: res.count };
    });
  }

  /** Record an execution result. The run starts automatically on the first result. */
  async record(ctx: ProjectCtx, resultId: string, input: RecordResultInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.testRunResult.findFirst({
        where: { id: resultId, testRun: { projectId: ctx.projectId, deletedAt: null } },
        include: { testRun: true },
      });
      if (!before) throw new NotFoundException('Result not found');
      const run = before.testRun;
      if (run.status === 'COMPLETED' || run.status === 'ABORTED')
        throw new BadRequestException('This run is closed. Reopen it to record results.');
      // Assigning others is a management action; executing is for anyone with run:execute.
      if (
        input.assigneeId !== undefined &&
        input.assigneeId !== ctx.actor.id &&
        !hasPermission(ctx.role, 'run:create')
      ) {
        throw new ForbiddenException('Only test managers can assign tests to others');
      }
      await this.assertMember(tx, ctx.organizationId, input.assigneeId);
      const steps = (before.snapshot as { steps: unknown[] }).steps.length;
      if (input.stepResults?.some((s) => s.index >= steps))
        throw new BadRequestException('A step result points at a step that does not exist');

      const executed = input.status && input.status !== 'UNTESTED' && input.status !== 'RETEST';
      const data: Prisma.TestRunResultUncheckedUpdateInput = {
        ...(input.status !== undefined && { status: input.status }),
        ...(input.stepResults !== undefined && {
          stepResults: input.stepResults as Prisma.InputJsonValue,
        }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.durationSec !== undefined && { durationSec: input.durationSec }),
        ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
        ...(input.status !== undefined &&
          (executed
            ? { executedById: ctx.actor.id, executedAt: new Date() }
            : { executedById: null, executedAt: null })),
      };
      const updated = await tx.testRunResult.update({ where: { id: resultId }, data });
      if (run.status === 'PLANNED' && executed) {
        await tx.testRun.update({
          where: { id: run.id },
          data: { status: 'IN_PROGRESS', startedAt: new Date() },
        });
      }
      if (input.status !== undefined && input.status !== before.status) {
        await this.audit.record(tx, ctx.actor, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          entityType: 'test_run_result',
          entityId: resultId,
          action: 'execute',
          before: { status: before.status },
          after: { status: input.status },
          metadata: { testRunId: run.id, ref: (before.snapshot as { ref: string }).ref },
        });
      }
      return updated;
    });
  }
}
