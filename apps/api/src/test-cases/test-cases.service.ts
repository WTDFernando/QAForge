import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type TestCase, type TestStep } from '@qaforge/db';
import {
  canTransition,
  formatRef,
  hasPermission,
  parseRef,
  type BulkTestCaseInput,
  type CreateTestCaseInput,
  type Role,
  type TestCaseQuery,
  type TestCaseStatus,
  type TestStepInput,
  type UpdateTestCaseInput,
} from '@qaforge/shared';
import { AuditService } from '../audit/audit.service';
import { nextSeq, type ProjectCtx } from '../common/project-scope';
import { PrismaService } from '../prisma/prisma.module';
import { withRef } from '../requirements/requirements.service';

type Tx = Prisma.TransactionClient;

/** Fields whose change creates a new version (and sends an approved case back to review). */
const CONTENT_FIELDS = [
  'title',
  'preconditions',
  'steps',
  'testData',
  'type',
  'technique',
] as const;

const listSelect = {
  id: true,
  seq: true,
  title: true,
  suiteId: true,
  priority: true,
  type: true,
  technique: true,
  status: true,
  automationStatus: true,
  tags: true,
  estimateMinutes: true,
  aiGenerated: true,
  aiConfidence: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  suite: { select: { id: true, name: true } },
  _count: { select: { steps: true } },
  requirements: {
    select: { requirement: { select: { id: true, seq: true, title: true } } },
    where: { requirement: { deletedAt: null } },
  },
} satisfies Prisma.TestCaseSelect;

function snapshot(
  tc: TestCase,
  steps: Pick<TestStep, 'action' | 'expected' | 'sharedStepId'>[],
  requirementIds: string[],
) {
  return {
    title: tc.title,
    preconditions: tc.preconditions,
    steps: steps.map((s) => ({
      action: s.action,
      expected: s.expected,
      sharedStepId: s.sharedStepId,
    })),
    testData: tc.testData,
    priority: tc.priority,
    type: tc.type,
    technique: tc.technique,
    status: tc.status,
    automationStatus: tc.automationStatus,
    tags: tc.tags,
    suiteId: tc.suiteId,
    requirementIds,
  };
}

function normSteps(steps: TestStepInput[]) {
  return steps.map((s) => ({
    action: s.action ?? '',
    expected: s.expected ?? '',
    sharedStepId: s.sharedStepId ?? null,
  }));
}

/** Who may move a case into `to`? Reaching APPROVED, or rejecting a case in review, needs testcase:approve. */
export function assertCanSetStatus(role: Role, from: TestCaseStatus, to: TestCaseStatus) {
  if (!canTransition(from, to))
    throw new BadRequestException(`Cannot move a test case from ${from} to ${to}`);
  if (from === to) return;
  const canWrite = hasPermission(role, 'testcase:write');
  const canApprove = hasPermission(role, 'testcase:approve');
  const approvalStep = to === 'APPROVED' || (from === 'IN_REVIEW' && to === 'DRAFT');
  if (to === 'APPROVED' && !canApprove)
    throw new ForbiddenException(
      'Only QA Leads, Admins, Owners and Clients can approve test cases',
    );
  if (!canWrite && !(canApprove && approvalStep))
    throw new ForbiddenException('You cannot change the status of test cases');
}

@Injectable()
export class TestCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async suiteIdsWithDescendants(projectId: string, rootId: string) {
    const all = await this.prisma.client.testSuite.findMany({
      where: { projectId },
      select: { id: true, parentId: true },
    });
    const ids = new Set([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of all)
        if (s.parentId && ids.has(s.parentId) && !ids.has(s.id)) (ids.add(s.id), (grew = true));
    }
    return [...ids];
  }

  async buildWhere(
    projectId: string,
    q: Partial<TestCaseQuery>,
  ): Promise<Prisma.TestCaseWhereInput> {
    const where: Prisma.TestCaseWhereInput = { projectId, deletedAt: null };
    if (q.suiteId === 'none') where.suiteId = null;
    else if (q.suiteId)
      where.suiteId =
        q.deep === false
          ? q.suiteId
          : { in: await this.suiteIdsWithDescendants(projectId, q.suiteId) };
    if (q.status?.length) where.status = { in: q.status };
    if (q.priority?.length) where.priority = { in: q.priority };
    if (q.type?.length) where.type = { in: q.type };
    if (q.automationStatus?.length) where.automationStatus = { in: q.automationStatus };
    if (q.tag) where.tags = { has: q.tag.toLowerCase() };
    if (q.aiGenerated !== undefined) where.aiGenerated = q.aiGenerated;
    if (q.requirementId) where.requirements = { some: { requirementId: q.requirementId } };
    if (q.q?.trim()) {
      const text = q.q.trim();
      const ref = parseRef(text);
      where.OR = [
        { title: { contains: text, mode: 'insensitive' } },
        { tags: { has: text.toLowerCase() } },
        ...(ref?.kind === 'testCase'
          ? [{ seq: ref.seq }]
          : /^\d+$/.test(text)
            ? [{ seq: Number(text) }]
            : []),
      ];
    }
    return where;
  }

  private orderBy(q: Partial<TestCaseQuery>): Prisma.TestCaseOrderByWithRelationInput[] {
    const dir = q.dir ?? 'asc';
    const field = q.sort ?? 'seq';
    return field === 'seq' ? [{ seq: dir }] : [{ [field]: dir }, { seq: 'asc' }];
  }

  private present(row: Prisma.TestCaseGetPayload<{ select: typeof listSelect }>) {
    const { _count, requirements, ...rest } = row;
    return {
      ...withRef(rest, 'testCase'),
      stepCount: _count.steps,
      requirements: requirements.map((l) => withRef(l.requirement, 'requirement')),
    };
  }

  async list(projectId: string, q: TestCaseQuery) {
    const where = await this.buildWhere(projectId, q);
    const [total, rows] = await Promise.all([
      this.prisma.client.testCase.count({ where }),
      this.prisma.client.testCase.findMany({
        where,
        select: listSelect,
        orderBy: this.orderBy(q),
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { items: rows.map((r) => this.present(r)), total, page: q.page, pageSize: q.pageSize };
  }

  /** All matching rows (for export), capped. */
  async listAll(projectId: string, q: Partial<TestCaseQuery>, cap = 10000) {
    const rows = await this.prisma.client.testCase.findMany({
      where: await this.buildWhere(projectId, q),
      select: {
        ...listSelect,
        preconditions: true,
        steps: { orderBy: { position: 'asc' }, include: { sharedStep: true } },
      },
      orderBy: this.orderBy(q),
      take: cap,
    });
    return rows.map(({ steps, preconditions, ...r }) => ({
      ...this.present(r),
      preconditions,
      steps,
    }));
  }

  async get(projectId: string, id: string) {
    const tc = await this.prisma.client.testCase.findFirst({
      where: { id, projectId, deletedAt: null },
      include: {
        suite: { select: { id: true, name: true } },
        steps: {
          orderBy: { position: 'asc' },
          include: { sharedStep: { select: { id: true, name: true, steps: true } } },
        },
        requirements: {
          where: { requirement: { deletedAt: null } },
          select: {
            requirement: { select: { id: true, seq: true, title: true, status: true, type: true } },
          },
        },
      },
    });
    if (!tc) throw new NotFoundException('Test case not found');
    const { requirements, ...rest } = tc;
    return {
      ...withRef(rest, 'testCase'),
      requirements: requirements.map((l) => withRef(l.requirement, 'requirement')),
    };
  }

  private async findOrThrow(tx: Tx, projectId: string, id: string) {
    const tc = await tx.testCase.findFirst({ where: { id, projectId, deletedAt: null } });
    if (!tc) throw new NotFoundException('Test case not found');
    return tc;
  }

  /** Referenced suites / requirements / shared steps must belong to the same project. */
  private async assertRefs(
    tx: Tx,
    projectId: string,
    refs: { suiteId?: string | null; requirementIds?: string[]; steps?: TestStepInput[] },
  ) {
    if (refs.suiteId) {
      const s = await tx.testSuite.findFirst({
        where: { id: refs.suiteId, projectId },
        select: { id: true },
      });
      if (!s) throw new BadRequestException('Suite not found in this project');
    }
    if (refs.requirementIds?.length) {
      const ids = [...new Set(refs.requirementIds)];
      const n = await tx.requirement.count({
        where: { id: { in: ids }, projectId, deletedAt: null },
      });
      if (n !== ids.length)
        throw new BadRequestException('Some requirements were not found in this project');
    }
    const shared = [
      ...new Set((refs.steps ?? []).map((s) => s.sharedStepId).filter((x): x is string => !!x)),
    ];
    if (shared.length) {
      const n = await tx.sharedStep.count({ where: { id: { in: shared }, projectId } });
      if (n !== shared.length)
        throw new BadRequestException('Some shared steps were not found in this project');
    }
  }

  async create(
    ctx: ProjectCtx,
    input: CreateTestCaseInput,
    extra: { aiGenerated?: boolean; aiConfidence?: number } = {},
  ) {
    if (input.status !== 'DRAFT') assertCanSetStatus(ctx.role, 'DRAFT', input.status);
    return this.prisma.client.$transaction(async (tx) => {
      await this.assertRefs(tx, ctx.projectId, input);
      const seq = await nextSeq(tx, ctx.projectId, 'testCase');
      const steps = normSteps(input.steps);
      const requirementIds = [...new Set(input.requirementIds)];
      const tc = await tx.testCase.create({
        data: {
          projectId: ctx.projectId,
          seq,
          suiteId: input.suiteId ?? null,
          title: input.title,
          preconditions: input.preconditions,
          testData: (input.testData ?? undefined) as Prisma.InputJsonValue | undefined,
          priority: input.priority,
          type: input.type,
          technique: input.technique ?? null,
          status: input.status,
          automationStatus: input.automationStatus,
          tags: [...new Set(input.tags)],
          estimateMinutes: input.estimateMinutes ?? null,
          aiGenerated: extra.aiGenerated ?? false,
          aiConfidence: extra.aiConfidence,
          createdById: ctx.actor.id,
          updatedById: ctx.actor.id,
          steps: { create: steps.map((s, position) => ({ ...s, position })) },
          requirements: {
            create: requirementIds.map((requirementId) => ({
              requirementId,
              createdById: ctx.actor.id,
            })),
          },
        },
      });
      await tx.testCaseVersion.create({
        data: {
          testCaseId: tc.id,
          version: 1,
          snapshot: snapshot(tc, steps, requirementIds) as Prisma.InputJsonValue,
          createdById: ctx.actor.id,
        },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'test_case',
        entityId: tc.id,
        action: 'create',
        after: { ref: formatRef('testCase', seq), title: tc.title, status: tc.status },
      });
      return withRef(tc, 'testCase');
    });
  }

  async update(ctx: ProjectCtx, id: string, input: UpdateTestCaseInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await this.findOrThrow(tx, ctx.projectId, id);
      await this.assertRefs(tx, ctx.projectId, input);
      const beforeSteps = await tx.testStep.findMany({
        where: { testCaseId: id },
        orderBy: { position: 'asc' },
      });
      const beforeReqIds = (
        await tx.requirementTestCase.findMany({
          where: { testCaseId: id },
          select: { requirementId: true },
        })
      ).map((r) => r.requirementId);

      const steps = input.steps ? normSteps(input.steps) : undefined;
      const changed = (f: (typeof CONTENT_FIELDS)[number]) => {
        if (input[f] === undefined) return false;
        const prev = f === 'steps' ? normSteps(beforeSteps) : before[f];
        const next = f === 'steps' ? steps : input[f];
        return JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null);
      };
      const contentChanged = CONTENT_FIELDS.some(changed);
      const reqIds = input.requirementIds ? [...new Set(input.requirementIds)] : undefined;
      const metaChanged =
        (['priority', 'automationStatus', 'tags', 'suiteId', 'estimateMinutes'] as const).some(
          (f) => input[f] !== undefined && JSON.stringify(input[f]) !== JSON.stringify(before[f]),
        ) ||
        (reqIds && JSON.stringify([...reqIds].sort()) !== JSON.stringify([...beforeReqIds].sort()));

      if (steps) {
        await tx.testStep.deleteMany({ where: { testCaseId: id } });
        await tx.testStep.createMany({
          data: steps.map((s, position) => ({ ...s, position, testCaseId: id })),
        });
      }
      if (reqIds) {
        await tx.requirementTestCase.deleteMany({
          where: { testCaseId: id, requirementId: { notIn: reqIds } },
        });
        await tx.requirementTestCase.createMany({
          data: reqIds.map((requirementId) => ({
            requirementId,
            testCaseId: id,
            createdById: ctx.actor.id,
          })),
          skipDuplicates: true,
        });
      }
      const data: Prisma.TestCaseUncheckedUpdateInput = {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.preconditions !== undefined && { preconditions: input.preconditions }),
        ...(input.testData !== undefined && {
          testData: (input.testData ?? Prisma.DbNull) as Prisma.InputJsonValue,
        }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.technique !== undefined && { technique: input.technique }),
        ...(input.automationStatus !== undefined && { automationStatus: input.automationStatus }),
        ...(input.tags !== undefined && { tags: [...new Set(input.tags)] }),
        ...(input.suiteId !== undefined && { suiteId: input.suiteId }),
        ...(input.estimateMinutes !== undefined && { estimateMinutes: input.estimateMinutes }),
        updatedById: ctx.actor.id,
      };
      // Editing an approved case's content sends it back for review.
      if (contentChanged && before.status === 'APPROVED') data.status = 'IN_REVIEW';
      if (contentChanged || metaChanged) data.version = before.version + 1;
      const tc = await tx.testCase.update({ where: { id }, data });
      if (contentChanged || metaChanged) {
        const finalSteps = steps ?? normSteps(beforeSteps);
        await tx.testCaseVersion.create({
          data: {
            testCaseId: id,
            version: tc.version,
            snapshot: {
              ...snapshot(tc, finalSteps, reqIds ?? beforeReqIds),
              changeNote: input.changeNote ?? null,
            } as Prisma.InputJsonValue,
            createdById: ctx.actor.id,
          },
        });
      }
      const { steps: _s, testData: _t, changeNote: _c, ...auditable } = input;
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'test_case',
        entityId: id,
        action: 'update',
        before: { ...before, requirementIds: beforeReqIds },
        after: {
          ...auditable,
          ...(reqIds && { requirementIds: reqIds }),
          ...(changed('steps') && { stepCount: steps!.length }),
          ...(data.status && { status: data.status }),
        },
        metadata: changed('steps') || changed('testData') ? { contentChanged: true } : undefined,
      });
      return withRef(tc, 'testCase');
    });
  }

  async setStatus(ctx: ProjectCtx, id: string, status: TestCaseStatus, note?: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await this.findOrThrow(tx, ctx.projectId, id);
      assertCanSetStatus(ctx.role, before.status, status);
      if (before.status === status) return withRef(before, 'testCase');
      const tc = await tx.testCase.update({
        where: { id },
        data: { status, updatedById: ctx.actor.id },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'test_case',
        entityId: id,
        action:
          status === 'APPROVED'
            ? 'approve'
            : before.status === 'IN_REVIEW' && status === 'DRAFT'
              ? 'reject'
              : 'update',
        before,
        after: { status },
        metadata: note ? { note } : undefined,
      });
      return withRef(tc, 'testCase');
    });
  }

  async bulk(ctx: ProjectCtx, input: BulkTestCaseInput) {
    const ids = [...new Set(input.ids)];
    if (input.action !== 'setStatus' && !hasPermission(ctx.role, 'testcase:write')) {
      throw new ForbiddenException('You cannot edit test cases');
    }
    return this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.testCase.findMany({
        where: {
          id: { in: ids },
          projectId: ctx.projectId,
          deletedAt: input.action === 'restore' ? { not: null } : null,
        },
      });
      if (rows.length === 0) throw new NotFoundException('No matching test cases');
      const now = new Date();
      if (input.action === 'move')
        await this.assertRefs(tx, ctx.projectId, { suiteId: input.suiteId });

      for (const tc of rows) {
        let data: Prisma.TestCaseUncheckedUpdateInput;
        let action = 'update';
        switch (input.action) {
          case 'setStatus':
            assertCanSetStatus(ctx.role, tc.status, input.status);
            data = { status: input.status };
            action = input.status === 'APPROVED' ? 'approve' : 'update';
            break;
          case 'setPriority':
            data = { priority: input.priority };
            break;
          case 'move':
            data = { suiteId: input.suiteId };
            break;
          case 'addTags':
            data = { tags: [...new Set([...tc.tags, ...input.tags])] };
            break;
          case 'removeTags':
            data = { tags: tc.tags.filter((t) => !input.tags.includes(t)) };
            break;
          case 'delete':
            data = { deletedAt: now };
            action = 'delete';
            break;
          case 'restore':
            data = { deletedAt: null };
            action = 'restore';
            break;
        }
        await tx.testCase.update({
          where: { id: tc.id },
          data: { ...data, updatedById: ctx.actor.id },
        });
        const { deletedAt: _d, ...after } = data as Record<string, unknown>;
        await this.audit.record(tx, ctx.actor, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          entityType: 'test_case',
          entityId: tc.id,
          action,
          before: tc,
          after: action === 'update' || action === 'approve' ? after : undefined,
          metadata: { bulk: true },
        });
      }
      // Previous values let the UI offer "Undo".
      return {
        updated: rows.length,
        previous: rows.map((r) => ({
          id: r.id,
          status: r.status,
          priority: r.priority,
          suiteId: r.suiteId,
          tags: r.tags,
        })),
      };
    });
  }

  async versions(projectId: string, id: string) {
    await this.findOrThrow(this.prisma.client, projectId, id);
    return this.prisma.client.testCaseVersion.findMany({
      where: { testCaseId: id },
      orderBy: { version: 'desc' },
    });
  }

  async tags(projectId: string) {
    const rows = await this.prisma.client.$queryRaw<{ tag: string; count: bigint }[]>`
      SELECT unnest(tags) AS tag, COUNT(*) AS count FROM test_case
      WHERE "projectId" = ${projectId}::uuid AND "deletedAt" IS NULL
      GROUP BY 1 ORDER BY 2 DESC, 1 ASC LIMIT 200`;
    return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
  }
}
