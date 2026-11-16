import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Bug } from '@qaforge/db';
import {
  BUG_SEVERITIES,
  canMoveBug,
  formatRef,
  OPEN_BUG_STATUSES,
  parseRef,
  richTextToPlain,
  type BugQuery,
  type CreateBugInput,
  type RichTextNode,
  type SetBugStatusInput,
  type UpdateBugInput,
} from '@qaforge/shared';
import { AuditService } from '../audit/audit.service';
import { nextSeq, type ProjectCtx } from '../common/project-scope';
import { NotificationsService } from '../notifications/notifications.module';
import { PrismaService } from '../prisma/prisma.module';

type Tx = Prisma.TransactionClient;
const CONTENT_FIELDS = [
  'title',
  'description',
  'stepsToReproduce',
  'expectedResult',
  'actualResult',
  'envDetails',
  'severity',
  'priority',
  'component',
] as const;

export const bugListSelect = {
  id: true,
  seq: true,
  title: true,
  status: true,
  resolution: true,
  severity: true,
  priority: true,
  component: true,
  assigneeId: true,
  createdById: true,
  rank: true,
  aiGenerated: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { testCases: true } },
} satisfies Prisma.BugSelect;

@Injectable()
export class BugsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private present<T extends { seq: number }>(b: T) {
    return { ...b, ref: formatRef('bug', b.seq) };
  }

  where(projectId: string, userId: string, q: Partial<BugQuery>): Prisma.BugWhereInput {
    const where: Prisma.BugWhereInput = { projectId, deletedAt: null };
    if (q.status?.length) where.status = { in: q.status };
    else if (q.openOnly) where.status = { in: [...OPEN_BUG_STATUSES] };
    if (q.severity?.length) where.severity = { in: q.severity };
    if (q.priority?.length) where.priority = { in: q.priority };
    if (q.assigneeId === 'me') where.assigneeId = userId;
    else if (q.assigneeId === 'none') where.assigneeId = null;
    else if (q.assigneeId) where.assigneeId = q.assigneeId;
    if (q.component) where.component = q.component;
    if (q.testCaseId) where.testCases = { some: { testCaseId: q.testCaseId } };
    if (q.aiGenerated !== undefined) where.aiGenerated = q.aiGenerated;
    if (q.q?.trim()) {
      const text = q.q.trim();
      const ref = parseRef(text);
      where.OR = [
        { title: { contains: text, mode: 'insensitive' } },
        { descriptionText: { contains: text, mode: 'insensitive' } },
        ...(ref?.kind === 'bug' ? [{ seq: ref.seq }] : []),
      ];
    }
    return where;
  }

  async list(projectId: string, userId: string, q: BugQuery) {
    const where = this.where(projectId, userId, q);
    const orderBy: Prisma.BugOrderByWithRelationInput[] =
      q.sort === 'seq' ? [{ seq: q.dir }] : [{ [q.sort]: q.dir }, { seq: 'desc' }];
    const [total, rows] = await Promise.all([
      this.prisma.client.bug.count({ where }),
      this.prisma.client.bug.findMany({
        where,
        select: bugListSelect,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { items: rows.map((r) => this.present(r)), total, page: q.page, pageSize: q.pageSize };
  }

  /** Kanban: every status column ordered by rank (closed limited to the most recent). */
  async board(projectId: string, userId: string, q: Partial<BugQuery>) {
    const base = this.where(projectId, userId, { ...q, status: undefined, openOnly: undefined });
    const [open, closed] = await Promise.all([
      this.prisma.client.bug.findMany({
        where: { ...base, status: { not: 'CLOSED' } },
        select: bugListSelect,
        orderBy: [{ rank: 'asc' }, { seq: 'asc' }],
        take: 1000,
      }),
      this.prisma.client.bug.findMany({
        where: { ...base, status: 'CLOSED' },
        select: bugListSelect,
        orderBy: { closedAt: 'desc' },
        take: 50,
      }),
    ]);
    return [...open, ...closed].map((r) => this.present(r));
  }

  async get(projectId: string, id: string) {
    const b = await this.prisma.client.bug.findFirst({
      where: { id, projectId, deletedAt: null },
      include: {
        environment: { select: { id: true, name: true } },
        duplicateOf: { select: { id: true, seq: true, title: true, status: true } },
        duplicates: {
          where: { deletedAt: null },
          select: { id: true, seq: true, title: true, status: true },
        },
        testCases: {
          where: { testCase: { deletedAt: null } },
          select: { testCase: { select: { id: true, seq: true, title: true, status: true } } },
        },
        testRunResult: {
          select: {
            id: true,
            snapshot: true,
            status: true,
            testRun: { select: { id: true, seq: true, name: true } },
          },
        },
      },
    });
    if (!b) throw new NotFoundException('Bug not found');
    const attachments = await this.prisma.client.attachment.findMany({
      where: { projectId, entityType: 'bug', entityId: id },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        size: true,
        annotations: true,
        scanStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const { testCases, testRunResult, duplicateOf, duplicates, ...rest } = b;
    const snap = testRunResult?.snapshot as
      { ref: string; title: string; steps: { action: string; expected: string }[] } | undefined;
    return {
      ...this.present(rest),
      duplicateOf: duplicateOf ? this.present(duplicateOf) : null,
      duplicates: duplicates.map((d) => this.present(d)),
      testCases: testCases.map((l) => ({
        ...l.testCase,
        ref: formatRef('testCase', l.testCase.seq),
      })),
      foundIn: testRunResult
        ? {
            resultId: testRunResult.id,
            run: { ...testRunResult.testRun, ref: formatRef('testRun', testRunResult.testRun.seq) },
            testCase: snap ? { ref: snap.ref, title: snap.title } : null,
            failedStep:
              b.failedStepIndex !== null && snap
                ? { index: b.failedStepIndex, ...snap.steps[b.failedStepIndex] }
                : null,
          }
        : null,
      attachments,
    };
  }

  async getByRef(projectId: string, seq: number) {
    const b = await this.prisma.client.bug.findFirst({
      where: { projectId, seq, deletedAt: null },
      select: { id: true },
    });
    if (!b) throw new NotFoundException('Bug not found');
    return this.get(projectId, b.id);
  }

  private async findOrThrow(tx: Tx, projectId: string, id: string) {
    const b = await tx.bug.findFirst({ where: { id, projectId, deletedAt: null } });
    if (!b) throw new NotFoundException('Bug not found');
    return b;
  }

  private async assertRefs(
    tx: Tx,
    ctx: ProjectCtx,
    refs: { assigneeId?: string | null; environmentId?: string | null; testCaseIds?: string[] },
  ) {
    if (refs.assigneeId) {
      const m = await tx.membership.findUnique({
        where: {
          organizationId_userId: { organizationId: ctx.organizationId, userId: refs.assigneeId },
        },
      });
      if (!m) throw new BadRequestException('Assignee is not a member of this organization');
    }
    if (refs.environmentId) {
      const e = await tx.environment.findFirst({
        where: { id: refs.environmentId, projectId: ctx.projectId },
      });
      if (!e) throw new BadRequestException('Environment not found in this project');
    }
    if (refs.testCaseIds?.length) {
      const ids = [...new Set(refs.testCaseIds)];
      const n = await tx.testCase.count({
        where: { id: { in: ids }, projectId: ctx.projectId, deletedAt: null },
      });
      if (n !== ids.length)
        throw new BadRequestException('Some test cases were not found in this project');
    }
  }

  /** Fractional rank for Kanban: place before `beforeId` in `status`, or at the end. */
  private async rankFor(
    tx: Tx,
    projectId: string,
    status: Bug['status'],
    beforeId?: string | null,
    excludeId?: string,
  ): Promise<number> {
    const col = await tx.bug.findMany({
      where: {
        projectId,
        status,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, rank: true },
      orderBy: [{ rank: 'asc' }, { seq: 'asc' }],
    });
    if (!beforeId) return (col.at(-1)?.rank ?? 0) + 1024;
    const i = col.findIndex((b) => b.id === beforeId);
    if (i === -1) return (col.at(-1)?.rank ?? 0) + 1024;
    const prev = i === 0 ? col[i]!.rank - 1024 : col[i - 1]!.rank;
    return (prev + col[i]!.rank) / 2;
  }

  async create(
    ctx: ProjectCtx,
    input: CreateBugInput,
    extra: { aiGenerated?: boolean; aiNotes?: Prisma.InputJsonValue; aiJobId?: string } = {},
  ) {
    const bug = await this.prisma.client.$transaction(async (tx) => {
      const testCaseIds = new Set(input.testCaseIds);
      let environmentId = input.environmentId ?? null;
      let envDetails = { ...input.envDetails };
      if (input.testRunResultId) {
        // Reported from a failed run result: link the case and inherit the run's environment and build.
        const r = await tx.testRunResult.findFirst({
          where: {
            id: input.testRunResultId,
            testRun: { projectId: ctx.projectId, deletedAt: null },
          },
          include: { testRun: true },
        });
        if (!r) throw new BadRequestException('Run result not found in this project');
        if (r.testCaseId) testCaseIds.add(r.testCaseId);
        environmentId = environmentId ?? r.testRun.environmentId;
        if (!envDetails.build && r.testRun.build)
          envDetails = { ...envDetails, build: r.testRun.build };
      }
      await this.assertRefs(tx, ctx, {
        assigneeId: input.assigneeId,
        environmentId,
        testCaseIds: [...testCaseIds],
      });
      const seq = await nextSeq(tx, ctx.projectId, 'bug');
      const description = input.description ?? null;
      const b = await tx.bug.create({
        data: {
          projectId: ctx.projectId,
          seq,
          title: input.title,
          description: (description ?? undefined) as Prisma.InputJsonValue | undefined,
          descriptionText: richTextToPlain(description),
          stepsToReproduce: input.stepsToReproduce,
          expectedResult: input.expectedResult,
          actualResult: input.actualResult,
          envDetails: envDetails as Prisma.InputJsonValue,
          environmentId,
          severity: input.severity,
          priority: input.priority,
          component: input.component ?? null,
          assigneeId: input.assigneeId ?? null,
          testRunResultId: input.testRunResultId ?? null,
          failedStepIndex: input.failedStepIndex ?? null,
          rank: await this.rankFor(tx, ctx.projectId, 'NEW'),
          aiGenerated: extra.aiGenerated ?? false,
          aiNotes: extra.aiNotes,
          aiJobId: extra.aiJobId,
          createdById: ctx.actor.id,
          updatedById: ctx.actor.id,
          testCases: {
            create: [...testCaseIds].map((testCaseId) => ({
              testCaseId,
              createdById: ctx.actor.id,
            })),
          },
        },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'bug',
        entityId: b.id,
        action: 'create',
        after: { ref: formatRef('bug', seq), title: b.title, severity: b.severity },
      });
      if (b.assigneeId) await this.notifyAssigned(tx, ctx, b);
      return b;
    });
    return this.present(bug);
  }

  private notifyAssigned(tx: Tx, ctx: ProjectCtx, b: Bug) {
    return this.notifications.notify(
      {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        userIds: [b.assigneeId!],
        actorId: ctx.actor.id,
        type: 'bug.assigned',
        title: `${formatRef('bug', b.seq)} was assigned to you`,
        body: b.title,
        entityType: 'bug',
        entityId: b.id,
      },
      tx,
    );
  }

  async update(ctx: ProjectCtx, id: string, input: UpdateBugInput) {
    const b = await this.prisma.client.$transaction(async (tx) => {
      const before = await this.findOrThrow(tx, ctx.projectId, id);
      await this.assertRefs(tx, ctx, input);
      const contentChanged = CONTENT_FIELDS.some(
        (f) => input[f] !== undefined && JSON.stringify(input[f]) !== JSON.stringify(before[f]),
      );
      if (input.testCaseIds) {
        const ids = [...new Set(input.testCaseIds)];
        await tx.testCaseBug.deleteMany({ where: { bugId: id, testCaseId: { notIn: ids } } });
        await tx.testCaseBug.createMany({
          data: ids.map((testCaseId) => ({ testCaseId, bugId: id, createdById: ctx.actor.id })),
          skipDuplicates: true,
        });
      }
      const data: Prisma.BugUncheckedUpdateInput = {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && {
          description: (input.description ?? Prisma.DbNull) as Prisma.InputJsonValue,
          descriptionText: richTextToPlain(input.description as RichTextNode | null),
        }),
        ...(input.stepsToReproduce !== undefined && { stepsToReproduce: input.stepsToReproduce }),
        ...(input.expectedResult !== undefined && { expectedResult: input.expectedResult }),
        ...(input.actualResult !== undefined && { actualResult: input.actualResult }),
        ...(input.envDetails !== undefined && {
          envDetails: input.envDetails as Prisma.InputJsonValue,
        }),
        ...(input.environmentId !== undefined && { environmentId: input.environmentId }),
        ...(input.severity !== undefined && { severity: input.severity }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.component !== undefined && { component: input.component }),
        ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
        ...(contentChanged && { version: before.version + 1 }),
        updatedById: ctx.actor.id,
      };
      const bug = await tx.bug.update({ where: { id }, data });
      const { description: _d, testCaseIds, ...auditable } = input;
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'bug',
        entityId: id,
        action: 'update',
        before,
        after: {
          ...auditable,
          ...(input.description !== undefined && { descriptionText: bug.descriptionText }),
          ...(testCaseIds && { testCaseIds }),
        },
      });
      if (input.assigneeId && input.assigneeId !== before.assigneeId)
        await this.notifyAssigned(tx, ctx, bug);
      return bug;
    });
    return this.present(b);
  }

  /** Workflow transition and/or Kanban reorder. */
  async setStatus(ctx: ProjectCtx, id: string, input: SetBugStatusInput) {
    const b = await this.prisma.client.$transaction(async (tx) => {
      const before = await this.findOrThrow(tx, ctx.projectId, id);
      if (!canMoveBug(before.status, input.status))
        throw new BadRequestException(`A bug can't move from ${before.status} to ${input.status}`);
      if (input.duplicateOfId) {
        if (input.duplicateOfId === id)
          throw new BadRequestException('A bug cannot duplicate itself');
        await this.findOrThrow(tx, ctx.projectId, input.duplicateOfId).catch(() => {
          throw new BadRequestException('The original bug was not found in this project');
        });
      }
      const changed = input.status !== before.status;
      const data: Prisma.BugUncheckedUpdateInput = {
        status: input.status,
        rank: await this.rankFor(tx, ctx.projectId, input.status, input.beforeId, id),
        updatedById: ctx.actor.id,
        ...(input.status === 'CLOSED' &&
          changed && {
            closedAt: new Date(),
            resolution: input.resolution!,
            duplicateOfId: input.resolution === 'DUPLICATE' ? input.duplicateOfId! : null,
          }),
        ...(input.status === 'REOPENED' && {
          closedAt: null,
          resolution: null,
          duplicateOfId: null,
        }),
        ...(input.status === 'FIXED' && { resolution: 'FIXED' }),
      };
      const bug = await tx.bug.update({ where: { id }, data });
      if (changed) {
        await this.audit.record(tx, ctx.actor, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          entityType: 'bug',
          entityId: id,
          action: 'update',
          before,
          after: {
            status: bug.status,
            resolution: bug.resolution,
            duplicateOfId: bug.duplicateOfId,
          },
        });
        await this.notifications.notify(
          {
            organizationId: ctx.organizationId,
            projectId: ctx.projectId,
            userIds: [before.createdById, before.assigneeId].filter((x): x is string => !!x),
            actorId: ctx.actor.id,
            type: input.status === 'READY_FOR_RETEST' ? 'bug.ready_for_retest' : 'bug.status',
            title: `${formatRef('bug', bug.seq)} is now ${input.status.replace(/_/g, ' ').toLowerCase()}`,
            body: bug.title,
            entityType: 'bug',
            entityId: id,
          },
          tx,
        );
      }
      return bug;
    });
    return this.present(b);
  }

  async remove(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      await this.findOrThrow(tx, ctx.projectId, id);
      await tx.bug.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'bug',
        entityId: id,
        action: 'delete',
      });
    });
  }

  async restore(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const b = await tx.bug.findFirst({
        where: { id, projectId: ctx.projectId, deletedAt: { not: null } },
      });
      if (!b) throw new NotFoundException('Bug not found');
      await tx.bug.update({ where: { id }, data: { deletedAt: null } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'bug',
        entityId: id,
        action: 'restore',
      });
    });
  }

  async components(projectId: string) {
    const rows = await this.prisma.client.bug.groupBy({
      by: ['component'],
      where: { projectId, deletedAt: null, component: { not: null } },
      _count: true,
      orderBy: { _count: { component: 'desc' } },
      take: 100,
    });
    return rows.map((r) => ({ component: r.component!, count: r._count }));
  }

  /** Similar open bugs by title (trigram); used by the report form and the Bug Agent. */
  async similar(projectId: string, title: string, excludeId?: string) {
    if (title.trim().length < 4) return [];
    const rows = await this.prisma.client.$queryRaw<
      { id: string; seq: number; title: string; status: string; similarity: number }[]
    >`
      SELECT id, seq, title, status::text AS status, similarity(title, ${title})::float AS similarity FROM bug
      WHERE "projectId" = ${projectId}::uuid AND "deletedAt" IS NULL AND similarity(title, ${title}) > 0.3
        ${excludeId ? Prisma.sql`AND id <> ${excludeId}::uuid` : Prisma.empty}
      ORDER BY similarity DESC LIMIT 5`;
    return rows.map((r) => ({
      ...r,
      ref: formatRef('bug', r.seq),
      similarity: Math.round(r.similarity * 100) / 100,
    }));
  }

  severityOrder() {
    return BUG_SEVERITIES;
  }
}
