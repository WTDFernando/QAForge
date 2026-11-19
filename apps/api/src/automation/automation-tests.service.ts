import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@qaforge/db';
import type { AutomationTestInput } from '@qaforge/shared';
import { AuditService } from '../audit/audit.service';
import type { ProjectCtx } from '../common/project-scope';
import { PrismaService } from '../prisma/prisma.module';

type Tx = Prisma.TransactionClient;

const listSelect = {
  id: true,
  name: true,
  path: true,
  status: true,
  tags: true,
  flakyScore: true,
  aiGenerated: true,
  version: true,
  testCaseId: true,
  pendingFix: true,
  updatedAt: true,
  testCase: { select: { id: true, seq: true, title: true } },
} satisfies Prisma.AutomationTestSelect;

@Injectable()
export class AutomationTestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(projectId: string) {
    const tests = await this.prisma.client.automationTest.findMany({
      where: { projectId, deletedAt: null },
      select: listSelect,
      orderBy: { path: 'asc' },
    });
    // Last result per test for the list (one query).
    const last = tests.length
      ? await this.prisma.client.$queryRaw<
          {
            automationTestId: string;
            status: string;
            flaky: boolean;
            createdAt: Date;
            durationMs: number | null;
          }[]
        >`
          SELECT DISTINCT ON ("automationTestId") "automationTestId", status::text AS status, flaky, "createdAt", "durationMs"
          FROM automation_result WHERE "automationTestId" = ANY(${tests.map((t) => t.id)}::uuid[])
          ORDER BY "automationTestId", "createdAt" DESC`
      : [];
    const byId = new Map(last.map((l) => [l.automationTestId, l]));
    return tests.map((t) => ({
      ...t,
      hasPendingFix: !!t.pendingFix,
      pendingFix: undefined,
      lastResult: byId.get(t.id) ?? null,
    }));
  }

  async get(projectId: string, id: string) {
    const t = await this.prisma.client.automationTest.findFirst({
      where: { id, projectId, deletedAt: null },
      include: {
        testCase: { select: { id: true, seq: true, title: true } },
        versions: {
          select: { version: true, reason: true, createdAt: true, createdById: true },
          orderBy: { version: 'desc' },
          take: 50,
        },
      },
    });
    if (!t) throw new NotFoundException('Test not found');
    return t;
  }

  async version(projectId: string, id: string, version: number) {
    const v = await this.prisma.client.automationTestVersion.findFirst({
      where: { automationTestId: id, version, automationTest: { projectId } },
    });
    if (!v) throw new NotFoundException('Version not found');
    return v;
  }

  private async assertTestCase(tx: Tx, projectId: string, id: string | null | undefined) {
    if (!id) return;
    if (!(await tx.testCase.findFirst({ where: { id, projectId, deletedAt: null } })))
      throw new BadRequestException('Linked test case not found in this project');
  }

  private async assertPathFree(tx: Tx, projectId: string, path: string, exceptId?: string) {
    const clash = await tx.automationTest.findFirst({
      where: { projectId, path, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (clash) throw new ConflictException(`A test already uses ${path}`);
  }

  async create(
    ctx: ProjectCtx,
    input: AutomationTestInput,
    extra: { aiGenerated?: boolean; aiJobId?: string; reason?: string } = {},
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      await this.assertTestCase(tx, ctx.projectId, input.testCaseId);
      await this.assertPathFree(tx, ctx.projectId, input.path);
      // A soft-deleted test may hold the same path: free it.
      await tx.automationTest.deleteMany({
        where: { projectId: ctx.projectId, path: input.path, deletedAt: { not: null } },
      });
      const t = await tx.automationTest.create({
        data: {
          projectId: ctx.projectId,
          name: input.name,
          path: input.path,
          code: input.code,
          tags: input.tags,
          status: input.status,
          testCaseId: input.testCaseId ?? null,
          aiGenerated: extra.aiGenerated ?? false,
          aiJobId: extra.aiJobId,
          createdById: ctx.actor.id,
          updatedById: ctx.actor.id,
          versions: {
            create: {
              version: 1,
              code: input.code,
              reason: extra.reason ?? 'edit',
              createdById: ctx.actor.id,
            },
          },
        },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'automation_test',
        entityId: t.id,
        action: 'create',
        after: { name: t.name, path: t.path },
      });
      return t;
    });
  }

  async update(
    ctx: ProjectCtx,
    id: string,
    input: Partial<AutomationTestInput> & { version?: number },
    reason = 'edit',
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.automationTest.findFirst({
        where: { id, projectId: ctx.projectId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Test not found');
      if (input.version !== undefined && input.version !== before.version)
        throw new ConflictException(
          `Someone saved version ${before.version} while you were editing. Reload to see their changes.`,
        );
      if (input.path && input.path !== before.path)
        await this.assertPathFree(tx, ctx.projectId, input.path, id);
      await this.assertTestCase(tx, ctx.projectId, input.testCaseId);
      const codeChanged = input.code !== undefined && input.code !== before.code;
      const t = await tx.automationTest.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.path !== undefined && { path: input.path }),
          ...(input.tags !== undefined && { tags: input.tags }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.testCaseId !== undefined && { testCaseId: input.testCaseId }),
          ...(codeChanged && { code: input.code, version: { increment: 1 } }),
          updatedById: ctx.actor.id,
        },
      });
      if (codeChanged)
        await tx.automationTestVersion.create({
          data: {
            automationTestId: id,
            version: t.version,
            code: t.code,
            reason,
            createdById: ctx.actor.id,
          },
        });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'automation_test',
        entityId: id,
        action: reason === 'edit' ? 'update' : reason,
        before: {
          name: before.name,
          path: before.path,
          status: before.status,
          tags: before.tags,
          testCaseId: before.testCaseId,
          version: before.version,
        },
        after: {
          name: t.name,
          path: t.path,
          status: t.status,
          tags: t.tags,
          testCaseId: t.testCaseId,
          version: t.version,
        },
      });
      return t;
    });
  }

  async remove(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const t = await tx.automationTest.findFirst({
        where: { id, projectId: ctx.projectId, deletedAt: null },
      });
      if (!t) throw new NotFoundException('Test not found');
      await tx.automationTest.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'automation_test',
        entityId: id,
        action: 'delete',
        before: { name: t.name },
      });
    });
  }

  /** Apply or dismiss a pending AI locator repair (the agent never edits code by itself). */
  async resolveFix(ctx: ProjectCtx, id: string, approve: boolean) {
    const t = await this.prisma.client.automationTest.findFirst({
      where: { id, projectId: ctx.projectId, deletedAt: null },
    });
    if (!t) throw new NotFoundException('Test not found');
    const fix = t.pendingFix as { code: string; jobId: string } | null;
    if (!fix) throw new BadRequestException('There is no suggested fix for this test');
    if (approve) {
      await this.update(ctx, id, { code: fix.code }, 'ai_repair');
    }
    return this.prisma.client.$transaction(async (tx) => {
      const r = await tx.automationTest.update({
        where: { id },
        data: { pendingFix: Prisma.DbNull },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'automation_test',
        entityId: id,
        action: approve ? 'approve_fix' : 'dismiss_fix',
        metadata: { jobId: fix.jobId },
      });
      return r;
    });
  }
}
