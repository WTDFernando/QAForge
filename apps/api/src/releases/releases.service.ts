import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_GATES,
  evaluateGate,
  formatRef,
  hasPermission,
  readiness,
  type ApprovalDecisionInput,
  type GateInput,
  type ReleaseInput,
  type ReleaseScopeInput,
  type Role,
} from '@qaforge/shared';
import { computeReleaseMetrics, nextSeq, Prisma, releaseBugs } from '@qaforge/db';
import { AuditService } from '../audit/audit.service';
import { rethrowUnique } from '../common/errors';
import type { ProjectCtx } from '../common/project-scope';
import { NotificationsService } from '../notifications/notifications.module';
import { PrismaService } from '../prisma/prisma.module';

type Tx = Prisma.TransactionClient;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const withRef = <T extends { seq: number }>(r: T) => ({ ...r, ref: formatRef('release', r.seq) });
/** Scope, gates and approvers can only change while the release is being prepared. */
const EDITABLE = new Set(['DRAFT', 'REJECTED']);

@Injectable()
export class ReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private async releaseOrThrow(db: Tx, projectId: string, idOrRef: string) {
    const seq = /^REL-(\d+)$/i.exec(idOrRef)?.[1];
    const r = await db.release.findFirst({
      where: {
        projectId,
        deletedAt: null,
        ...(seq ? { seq: Number(seq) } : { id: idOrRef }),
      },
    });
    if (!r) throw new NotFoundException('Release not found');
    return r;
  }

  /** Live gate results and readiness for a release. */
  async evaluate(db: Tx, releaseId: string) {
    const [metrics, gates] = await Promise.all([
      computeReleaseMetrics(db, releaseId),
      db.qualityGate.findMany({ where: { releaseId }, orderBy: { position: 'asc' } }),
    ]);
    const results = gates.map((g) => ({
      id: g.id,
      ...evaluateGate(metrics, {
        metric: g.metric,
        operator: g.operator,
        threshold: g.threshold,
        params: (g.params ?? {}) as GateInput['params'],
        blocking: g.blocking,
      }),
    }));
    return { metrics, gates: results, readiness: readiness(metrics, results) };
  }

  async list(projectId: string) {
    const db = this.prisma.client;
    const rows = await db.release.findMany({
      where: { projectId, deletedAt: null },
      orderBy: [{ targetDate: { sort: 'desc', nulls: 'first' } }, { seq: 'desc' }],
      take: 100,
      include: {
        approvals: { select: { status: true } },
        _count: { select: { items: true, testRuns: true } },
      },
    });
    // Readiness is live for open releases; released ones show what was frozen at approval.
    return Promise.all(
      rows.map(async (r) => {
        const live = r.status === 'RELEASED' ? null : await this.evaluate(db, r.id);
        const frozen = r.gateSnapshot as { readiness?: unknown } | null;
        return {
          ...withRef(r),
          readiness: live?.readiness ?? frozen?.readiness ?? null,
          gatesPassed: live ? live.gates.filter((g) => g.passed).length : null,
          gatesTotal: live?.gates.length ?? null,
        };
      }),
    );
  }

  async get(projectId: string, idOrRef: string) {
    const db = this.prisma.client;
    const r = await this.releaseOrThrow(db, projectId, idOrRef);
    const [items, runs, approvals, evaluation] = await Promise.all([
      db.releaseItem.findMany({
        where: { releaseId: r.id },
        include: {
          requirement: {
            select: {
              id: true,
              seq: true,
              title: true,
              priority: true,
              status: true,
              _count: { select: { testCases: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      db.testRun.findMany({
        where: { releaseId: r.id, deletedAt: null },
        select: {
          id: true,
          seq: true,
          name: true,
          status: true,
          source: true,
          build: true,
          environment: { select: { name: true } },
          _count: { select: { results: true } },
        },
        orderBy: { seq: 'asc' },
      }),
      db.approval.findMany({
        where: { releaseId: r.id },
        include: { approver: { select: { id: true, name: true, email: true, image: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.evaluate(db, r.id),
    ]);
    const bugs = await releaseBugs(
      db,
      r.id,
      runs.map((x) => x.id),
    );
    const inScope = new Set(items.filter((i) => i.bugId).map((i) => i.bugId));
    return {
      ...withRef(r),
      requirements: items
        .filter((i) => i.requirement)
        .map((i) => ({ ...i.requirement!, ref: formatRef('requirement', i.requirement!.seq) })),
      bugs: bugs.map((b) => ({ ...b, ref: formatRef('bug', b.seq), inScope: inScope.has(b.id) })),
      testRuns: runs.map((x) => ({ ...x, ref: formatRef('testRun', x.seq) })),
      approvals,
      ...evaluation,
    };
  }

  async create(ctx: ProjectCtx, input: ReleaseInput) {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const seq = await nextSeq(tx, ctx.projectId, 'release');
        const r = await tx.release.create({
          data: {
            projectId: ctx.projectId,
            seq,
            name: input.name,
            version: input.version,
            description: input.description,
            targetDate: input.targetDate ?? null,
            createdById: ctx.actor.id,
            updatedById: ctx.actor.id,
            gates: {
              create: DEFAULT_GATES.map((g, i) => ({ ...g, params: json(g.params), position: i })),
            },
          },
        });
        await this.audit.record(tx, ctx.actor, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          entityType: 'release',
          entityId: r.id,
          action: 'create',
          after: { ref: formatRef('release', seq), name: r.name, version: r.version },
        });
        return withRef(r);
      });
    } catch (e) {
      rethrowUnique(e, `Version ${input.version} already exists in this project`);
    }
  }

  async update(ctx: ProjectCtx, id: string, input: Partial<ReleaseInput>) {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const before = await this.releaseOrThrow(tx, ctx.projectId, id);
        const r = await tx.release.update({
          where: { id: before.id },
          data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.version !== undefined && { version: input.version }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.targetDate !== undefined && { targetDate: input.targetDate }),
            updatedById: ctx.actor.id,
          },
        });
        await this.audit.record(tx, ctx.actor, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          entityType: 'release',
          entityId: r.id,
          action: 'update',
          before: { name: before.name, version: before.version, targetDate: before.targetDate },
          after: { name: r.name, version: r.version, targetDate: r.targetDate },
        });
        return withRef(r);
      });
    } catch (e) {
      rethrowUnique(e, `Version ${input.version} already exists in this project`);
    }
  }

  async remove(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const r = await this.releaseOrThrow(tx, ctx.projectId, id);
      if (r.status === 'RELEASED')
        throw new BadRequestException(
          'A shipped release is part of the history and can’t be deleted',
        );
      await tx.release.update({ where: { id: r.id }, data: { deletedAt: new Date() } });
      await tx.testRun.updateMany({ where: { releaseId: r.id }, data: { releaseId: null } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'release',
        entityId: r.id,
        action: 'delete',
      });
    });
  }

  private assertEditable(r: { status: string }) {
    if (!EDITABLE.has(r.status))
      throw new ConflictException(
        'Move the release back to draft before changing its scope, gates or approvers',
      );
  }

  async scope(ctx: ProjectCtx, id: string, input: ReleaseScopeInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const r = await this.releaseOrThrow(tx, ctx.projectId, id);
      this.assertEditable(r);
      const { add, remove } = input;
      // Everything added must belong to this project.
      const [reqs, bugs, runs] = await Promise.all([
        tx.requirement.count({
          where: { id: { in: add.requirementIds }, projectId: ctx.projectId, deletedAt: null },
        }),
        tx.bug.count({
          where: { id: { in: add.bugIds }, projectId: ctx.projectId, deletedAt: null },
        }),
        tx.testRun.count({
          where: { id: { in: add.testRunIds }, projectId: ctx.projectId, deletedAt: null },
        }),
      ]);
      if (
        reqs !== new Set(add.requirementIds).size ||
        bugs !== new Set(add.bugIds).size ||
        runs !== new Set(add.testRunIds).size
      )
        throw new BadRequestException('Some items were not found in this project');
      const taken = await tx.testRun.findFirst({
        where: { id: { in: add.testRunIds }, releaseId: { not: null }, NOT: { releaseId: r.id } },
        select: { seq: true, release: { select: { seq: true } } },
      });
      if (taken)
        throw new ConflictException(
          `${formatRef('testRun', taken.seq)} already belongs to ${formatRef('release', taken.release!.seq)}`,
        );
      await tx.releaseItem.createMany({
        data: [
          ...add.requirementIds.map((requirementId) => ({
            releaseId: r.id,
            requirementId,
            createdById: ctx.actor.id,
          })),
          ...add.bugIds.map((bugId) => ({ releaseId: r.id, bugId, createdById: ctx.actor.id })),
        ],
        skipDuplicates: true,
      });
      if (add.testRunIds.length)
        await tx.testRun.updateMany({
          where: { id: { in: add.testRunIds } },
          data: { releaseId: r.id },
        });
      await tx.releaseItem.deleteMany({
        where: {
          releaseId: r.id,
          OR: [{ requirementId: { in: remove.requirementIds } }, { bugId: { in: remove.bugIds } }],
        },
      });
      if (remove.testRunIds.length)
        await tx.testRun.updateMany({
          where: { id: { in: remove.testRunIds }, releaseId: r.id },
          data: { releaseId: null },
        });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'release',
        entityId: r.id,
        action: 'update_scope',
        metadata: { ...input },
      });
      return { ok: true };
    });
  }

  async setGates(ctx: ProjectCtx, id: string, gates: GateInput[]) {
    return this.prisma.client.$transaction(async (tx) => {
      const r = await this.releaseOrThrow(tx, ctx.projectId, id);
      this.assertEditable(r);
      const before = await tx.qualityGate.findMany({ where: { releaseId: r.id } });
      await tx.qualityGate.deleteMany({ where: { releaseId: r.id } });
      await tx.qualityGate.createMany({
        data: gates.map((g, i) => ({ ...g, params: json(g.params), releaseId: r.id, position: i })),
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'release',
        entityId: r.id,
        action: 'update_gates',
        before: {
          gates: before.map(({ metric, operator, threshold, blocking }) => ({
            metric,
            operator,
            threshold,
            blocking,
          })),
        },
        after: {
          gates: gates.map(({ metric, operator, threshold, blocking }) => ({
            metric,
            operator,
            threshold,
            blocking,
          })),
        },
      });
      return this.evaluate(tx, r.id);
    });
  }

  /** Effective role in the project (project override beats the org role, except for Owners). */
  private async roleOf(tx: Tx, organizationId: string, projectId: string, userId: string) {
    const m = await tx.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    if (!m) return null;
    if (m.role === 'OWNER') return m.role as Role;
    const o = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    return (o?.role ?? m.role) as Role;
  }

  async setApprovers(
    ctx: ProjectCtx,
    id: string,
    approvers: { userId: string; roleLabel: string }[],
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const r = await this.releaseOrThrow(tx, ctx.projectId, id);
      this.assertEditable(r);
      for (const a of approvers) {
        const role = await this.roleOf(tx, ctx.organizationId, ctx.projectId, a.userId);
        if (!role) throw new BadRequestException('Approvers must be members of the organization');
        if (!hasPermission(role, 'release:approve'))
          throw new BadRequestException(
            `This person’s role (${role}) can’t approve releases. Pick a QA Lead, Admin, Owner or Client.`,
          );
      }
      const keep = approvers.map((a) => a.userId);
      await tx.approval.deleteMany({ where: { releaseId: r.id, approverId: { notIn: keep } } });
      for (const a of approvers)
        await tx.approval.upsert({
          where: { releaseId_approverId: { releaseId: r.id, approverId: a.userId } },
          create: { releaseId: r.id, approverId: a.userId, roleLabel: a.roleLabel },
          update: { roleLabel: a.roleLabel },
        });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'release',
        entityId: r.id,
        action: 'update_approvers',
        after: { approvers },
      });
      return tx.approval.findMany({ where: { releaseId: r.id } });
    });
  }

  /** Freeze the gates and ask every named approver to sign off. */
  async requestApproval(ctx: ProjectCtx, id: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const r = await this.releaseOrThrow(tx, ctx.projectId, id);
      this.assertEditable(r);
      const approvers = await tx.approval.findMany({ where: { releaseId: r.id } });
      if (!approvers.length) throw new BadRequestException('Add at least one approver first');
      const ev = await this.evaluate(tx, r.id);
      const failing = ev.gates.filter((g) => g.blocking && !g.passed);
      if (failing.length)
        throw new ConflictException(
          `${failing.length} blocking quality gate${failing.length === 1 ? ' fails' : 's fail'}. Fix them, or make them non-blocking, before asking for approval.`,
        );
      const snapshot = json({ ...ev, frozenAt: new Date().toISOString() });
      const updated = await tx.release.update({
        where: { id: r.id },
        data: {
          status: 'PENDING_APPROVAL',
          gateSnapshot: snapshot,
          requestedAt: new Date(),
          updatedById: ctx.actor.id,
        },
      });
      await tx.approval.updateMany({
        where: { releaseId: r.id },
        data: { status: 'PENDING', comment: '', decidedAt: null, gateSnapshot: Prisma.DbNull },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'release',
        entityId: r.id,
        action: 'request_approval',
        before: { status: r.status },
        after: { status: 'PENDING_APPROVAL', score: ev.readiness.score },
      });
      await this.notifications.notify(
        {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          userIds: approvers.map((a) => a.approverId),
          actorId: ctx.actor.id,
          type: 'release.approval_requested',
          title: `${formatRef('release', r.seq)} ${r.name} needs your approval`,
          body: `Readiness ${ev.readiness.score}/100 · ${ev.gates.filter((g) => g.passed).length} of ${ev.gates.length} gates pass`,
          entityType: 'release',
          entityId: r.id,
        },
        tx,
      );
      return withRef(updated);
    });
  }

  async decide(ctx: ProjectCtx, id: string, input: ApprovalDecisionInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const r = await this.releaseOrThrow(tx, ctx.projectId, id);
      if (r.status !== 'PENDING_APPROVAL')
        throw new ConflictException('This release is not waiting for approval');
      const mine = await tx.approval.findUnique({
        where: { releaseId_approverId: { releaseId: r.id, approverId: ctx.actor.id } },
      });
      if (!mine) throw new ForbiddenException('You are not an approver of this release');
      if (mine.status !== 'PENDING')
        throw new ConflictException('You have already decided on this release');
      const ev = await this.evaluate(tx, r.id);
      await tx.approval.update({
        where: { id: mine.id },
        data: {
          status: input.decision,
          comment: input.comment,
          decidedAt: new Date(),
          gateSnapshot: json(ev),
        },
      });
      const all = await tx.approval.findMany({ where: { releaseId: r.id } });
      const next =
        input.decision === 'REJECTED'
          ? 'REJECTED'
          : all.every((a) => a.status === 'APPROVED')
            ? 'APPROVED'
            : 'PENDING_APPROVAL';
      if (next !== r.status)
        await tx.release.update({ where: { id: r.id }, data: { status: next } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'release',
        entityId: r.id,
        action: input.decision === 'APPROVED' ? 'approve' : 'reject',
        after: { comment: input.comment, releaseStatus: next, score: ev.readiness.score },
      });
      const others = [r.createdById, ...all.map((a) => a.approverId)];
      await this.notifications.notify(
        {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          userIds: others,
          actorId: ctx.actor.id,
          type:
            next === 'APPROVED'
              ? 'release.approved'
              : next === 'REJECTED'
                ? 'release.rejected'
                : 'release.approval_given',
          title:
            next === 'APPROVED'
              ? `${formatRef('release', r.seq)} ${r.name} is approved`
              : next === 'REJECTED'
                ? `${formatRef('release', r.seq)} ${r.name} was rejected`
                : `${mine.roleLabel} approved ${formatRef('release', r.seq)}`,
          body: input.comment,
          entityType: 'release',
          entityId: r.id,
        },
        tx,
      );
      return { status: next };
    });
  }

  /** Back to draft: approvals are cleared so the next request starts fresh. */
  async reopen(ctx: ProjectCtx, id: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const r = await this.releaseOrThrow(tx, ctx.projectId, id);
      if (r.status === 'DRAFT') return withRef(r);
      if (r.status === 'RELEASED')
        throw new ConflictException('A shipped release can’t be reopened; create a new release');
      const updated = await tx.release.update({
        where: { id: r.id },
        data: { status: 'DRAFT', updatedById: ctx.actor.id },
      });
      await tx.approval.updateMany({
        where: { releaseId: r.id },
        data: { status: 'PENDING', decidedAt: null },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'release',
        entityId: r.id,
        action: 'reopen',
        before: { status: r.status },
        after: { status: 'DRAFT' },
      });
      return withRef(updated);
    });
  }

  async markReleased(ctx: ProjectCtx, id: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const r = await this.releaseOrThrow(tx, ctx.projectId, id);
      if (r.status !== 'APPROVED')
        throw new ConflictException('Only an approved release can be marked as released');
      const updated = await tx.release.update({
        where: { id: r.id },
        data: { status: 'RELEASED', releasedAt: new Date(), updatedById: ctx.actor.id },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'release',
        entityId: r.id,
        action: 'release',
        before: { status: 'APPROVED' },
        after: { status: 'RELEASED' },
      });
      return withRef(updated);
    });
  }
}
