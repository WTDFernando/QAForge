import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Requirement } from '@qaforge/db';
import {
  formatRef,
  richTextToPlain,
  type CreateRequirementInput,
  type MoveInput,
  type RequirementType,
  type RichTextNode,
  type UpdateRequirementInput,
} from '@qaforge/shared';
import { AuditService } from '../audit/audit.service';
import { nextSeq, type ProjectCtx } from '../common/project-scope';
import { PrismaService } from '../prisma/prisma.module';

const RANK: Record<RequirementType, number> = { EPIC: 0, FEATURE: 1, STORY: 2 };
const CONTENT_FIELDS = [
  'title',
  'type',
  'description',
  'acceptanceCriteria',
  'priority',
  'status',
] as const;

type Tx = Prisma.TransactionClient;

export function withRef<T extends { seq: number }>(row: T, kind: 'requirement' | 'testCase') {
  return { ...row, ref: formatRef(kind, row.seq) };
}

function snapshot(r: Requirement) {
  return {
    title: r.title,
    type: r.type,
    description: r.description,
    acceptanceCriteria: r.acceptanceCriteria,
    priority: r.priority,
    status: r.status,
    parentId: r.parentId,
  };
}

@Injectable()
export class RequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Flat list (the client builds the tree from parentId + position). */
  async list(projectId: string) {
    const rows = await this.prisma.client.requirement.findMany({
      where: { projectId, deletedAt: null },
      select: {
        id: true,
        seq: true,
        type: true,
        title: true,
        priority: true,
        status: true,
        parentId: true,
        position: true,
        clarityScore: true,
        aiGenerated: true,
        acceptanceCriteria: true,
        updatedAt: true,
        _count: { select: { testCases: { where: { testCase: { deletedAt: null } } } } },
      },
      orderBy: [{ position: 'asc' }, { seq: 'asc' }],
    });
    return rows.map(({ _count, acceptanceCriteria, ...r }) => ({
      ...withRef(r, 'requirement'),
      acceptanceCriteriaCount: acceptanceCriteria.length,
      testCaseCount: _count.testCases,
    }));
  }

  async get(projectId: string, id: string) {
    const r = await this.prisma.client.requirement.findFirst({
      where: { id, projectId, deletedAt: null },
      include: {
        source: { select: { id: true, name: true, kind: true, url: true, attachmentId: true } },
        testCases: {
          where: { testCase: { deletedAt: null } },
          select: {
            testCase: {
              select: { id: true, seq: true, title: true, status: true, priority: true },
            },
          },
          orderBy: { testCase: { seq: 'asc' } },
        },
      },
    });
    if (!r) throw new NotFoundException('Requirement not found');
    const { testCases, ...rest } = r;
    return {
      ...withRef(rest, 'requirement'),
      testCases: testCases.map((l) => withRef(l.testCase, 'testCase')),
    };
  }

  private async findOrThrow(tx: Tx, projectId: string, id: string) {
    const r = await tx.requirement.findFirst({ where: { id, projectId, deletedAt: null } });
    if (!r) throw new NotFoundException('Requirement not found');
    return r;
  }

  /** Parent must exist in the project, sit higher in the Epic > Feature > Story hierarchy and not create a cycle. */
  private async assertParent(
    tx: Tx,
    projectId: string,
    parentId: string | null | undefined,
    type: RequirementType,
    selfId?: string,
  ) {
    if (!parentId) return;
    if (parentId === selfId)
      throw new BadRequestException('A requirement cannot be its own parent');
    const parent = await tx.requirement.findFirst({
      where: { id: parentId, projectId, deletedAt: null },
    });
    if (!parent) throw new BadRequestException('Parent requirement not found');
    if (RANK[parent.type] >= RANK[type]) {
      throw new BadRequestException(
        `A ${type.toLowerCase()} cannot be placed under a ${parent.type.toLowerCase()}`,
      );
    }
    if (selfId) {
      // Walk up from the new parent; hitting self means a cycle.
      let cursor: string | null = parent.parentId;
      while (cursor) {
        if (cursor === selfId)
          throw new BadRequestException('Cannot move a requirement under its own descendant');
        const next: { parentId: string | null } | null = await tx.requirement.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
        cursor = next?.parentId ?? null;
      }
    }
  }

  private async assertChildrenFit(tx: Tx, id: string, type: RequirementType) {
    const child = await tx.requirement.findFirst({
      where: { parentId: id, deletedAt: null },
      select: { type: true },
    });
    if (child && RANK[child.type] <= RANK[type]) {
      throw new BadRequestException(`It has ${child.type.toLowerCase()} children; move them first`);
    }
  }

  async create(
    ctx: ProjectCtx,
    input: CreateRequirementInput,
    extra: { sourceId?: string; aiGenerated?: boolean } = {},
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      await this.assertParent(tx, ctx.projectId, input.parentId, input.type);
      const seq = await nextSeq(tx, ctx.projectId, 'requirement');
      const last = await tx.requirement.aggregate({
        where: { projectId: ctx.projectId, parentId: input.parentId ?? null },
        _max: { position: true },
      });
      const r = await tx.requirement.create({
        data: {
          projectId: ctx.projectId,
          seq,
          title: input.title,
          type: input.type,
          description: (input.description ?? undefined) as Prisma.InputJsonValue | undefined,
          descriptionText: richTextToPlain(input.description),
          acceptanceCriteria: input.acceptanceCriteria,
          priority: input.priority,
          status: input.status,
          parentId: input.parentId ?? null,
          position: (last._max.position ?? -1) + 1,
          sourceId: extra.sourceId,
          aiGenerated: extra.aiGenerated ?? false,
          createdById: ctx.actor.id,
          updatedById: ctx.actor.id,
        },
      });
      await tx.requirementVersion.create({
        data: {
          requirementId: r.id,
          version: 1,
          snapshot: snapshot(r) as Prisma.InputJsonValue,
          createdById: ctx.actor.id,
        },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'requirement',
        entityId: r.id,
        action: 'create',
        after: { ref: formatRef('requirement', seq), title: r.title, type: r.type },
      });
      return withRef(r, 'requirement');
    });
  }

  async update(ctx: ProjectCtx, id: string, input: UpdateRequirementInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await this.findOrThrow(tx, ctx.projectId, id);
      const type = input.type ?? before.type;
      if (input.parentId !== undefined && input.parentId !== before.parentId) {
        await this.assertParent(tx, ctx.projectId, input.parentId, type, id);
      } else if (input.type && input.type !== before.type) {
        await this.assertParent(tx, ctx.projectId, before.parentId, type, id);
      }
      if (input.type && input.type !== before.type)
        await this.assertChildrenFit(tx, id, input.type);

      const data: Prisma.RequirementUpdateInput = {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.acceptanceCriteria !== undefined && {
          acceptanceCriteria: input.acceptanceCriteria,
        }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.parentId !== undefined && {
          parent: input.parentId ? { connect: { id: input.parentId } } : { disconnect: true },
        }),
        ...(input.description !== undefined && {
          description: (input.description ?? Prisma.DbNull) as Prisma.InputJsonValue,
          descriptionText: richTextToPlain(input.description as RichTextNode | null),
        }),
        updatedById: ctx.actor.id,
      };
      const contentChanged = CONTENT_FIELDS.some(
        (f) => input[f] !== undefined && JSON.stringify(input[f]) !== JSON.stringify(before[f]),
      );
      if (contentChanged) data.version = before.version + 1;
      const r = await tx.requirement.update({ where: { id }, data });
      if (contentChanged) {
        await tx.requirementVersion.create({
          data: {
            requirementId: id,
            version: r.version,
            snapshot: snapshot(r) as Prisma.InputJsonValue,
            createdById: ctx.actor.id,
          },
        });
      }
      const { description: _d, ...auditable } = input;
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'requirement',
        entityId: id,
        action: 'update',
        before,
        after: {
          ...auditable,
          ...(input.description !== undefined && { descriptionText: r.descriptionText }),
        },
      });
      return withRef(r, 'requirement');
    });
  }

  /** Reparent and/or reorder (drag and drop in the tree). */
  async move(ctx: ProjectCtx, id: string, input: MoveInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const r = await this.findOrThrow(tx, ctx.projectId, id);
      if (input.parentId !== r.parentId)
        await this.assertParent(tx, ctx.projectId, input.parentId, r.type, id);
      const siblings = await tx.requirement.findMany({
        where: {
          projectId: ctx.projectId,
          parentId: input.parentId,
          deletedAt: null,
          id: { not: id },
        },
        orderBy: [{ position: 'asc' }, { seq: 'asc' }],
        select: { id: true },
      });
      const order = siblings.map((s) => s.id);
      const at = input.beforeId ? order.indexOf(input.beforeId) : -1;
      order.splice(at === -1 ? order.length : at, 0, id);
      await Promise.all(
        order.map((sid, position) =>
          tx.requirement.update({
            where: { id: sid },
            data: sid === id ? { position, parentId: input.parentId } : { position },
          }),
        ),
      );
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'requirement',
        entityId: id,
        action: 'update',
        before: { parentId: r.parentId },
        after: { parentId: input.parentId },
      });
      return { id, parentId: input.parentId, position: order.indexOf(id) };
    });
  }

  /** Soft-deletes the requirement and its subtree. Returns affected ids (for undo). */
  async remove(ctx: ProjectCtx, id: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const root = await this.findOrThrow(tx, ctx.projectId, id);
      const ids = [root.id];
      for (let frontier = [root.id]; frontier.length;) {
        const kids = await tx.requirement.findMany({
          where: { parentId: { in: frontier }, deletedAt: null },
          select: { id: true },
        });
        frontier = kids.map((k) => k.id);
        ids.push(...frontier);
      }
      await tx.requirement.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt: new Date() },
      });
      for (const rid of ids) {
        await this.audit.record(tx, ctx.actor, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          entityType: 'requirement',
          entityId: rid,
          action: 'delete',
        });
      }
      return { ids };
    });
  }

  async restore(ctx: ProjectCtx, ids: string[]) {
    return this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.requirement.findMany({
        where: { id: { in: ids }, projectId: ctx.projectId, deletedAt: { not: null } },
      });
      await tx.requirement.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { deletedAt: null },
      });
      for (const r of rows) {
        await this.audit.record(tx, ctx.actor, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          entityType: 'requirement',
          entityId: r.id,
          action: 'restore',
        });
      }
      return { restored: rows.length };
    });
  }

  async versions(projectId: string, id: string) {
    await this.findOrThrow(this.prisma.client, projectId, id);
    return this.prisma.client.requirementVersion.findMany({
      where: { requirementId: id },
      orderBy: { version: 'desc' },
    });
  }

  async link(ctx: ProjectCtx, id: string, testCaseIds: string[]) {
    return this.prisma.client.$transaction(async (tx) => {
      await this.findOrThrow(tx, ctx.projectId, id);
      const valid = await tx.testCase.findMany({
        where: { id: { in: testCaseIds }, projectId: ctx.projectId, deletedAt: null },
        select: { id: true },
      });
      if (valid.length !== new Set(testCaseIds).size)
        throw new BadRequestException('Some test cases were not found in this project');
      const res = await tx.requirementTestCase.createMany({
        data: valid.map((t) => ({
          requirementId: id,
          testCaseId: t.id,
          createdById: ctx.actor.id,
        })),
        skipDuplicates: true,
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'requirement',
        entityId: id,
        action: 'link',
        metadata: { testCaseIds },
      });
      return { linked: res.count };
    });
  }

  async unlink(ctx: ProjectCtx, id: string, testCaseId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      await this.findOrThrow(tx, ctx.projectId, id);
      await tx.requirementTestCase.deleteMany({ where: { requirementId: id, testCaseId } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'requirement',
        entityId: id,
        action: 'unlink',
        metadata: { testCaseId },
      });
    });
  }
}
