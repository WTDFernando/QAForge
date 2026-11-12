import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  createSuiteSchema,
  moveSchema,
  updateSuiteSchema,
  type CreateSuiteInput,
  type MoveInput,
} from '@qaforge/shared';
import type { Prisma } from '@qaforge/db';
import { RequirePermission } from '../auth/decorators';
import { AuditService } from '../audit/audit.service';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { PrismaService } from '../prisma/prisma.module';

class CreateSuiteDto extends createZodDto(createSuiteSchema) {}
class UpdateSuiteDto extends createZodDto(updateSuiteSchema) {}
class MoveDto extends createZodDto(moveSchema) {}

@Injectable()
export class SuitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(projectId: string) {
    const [suites, counts, unsorted] = await Promise.all([
      this.prisma.client.testSuite.findMany({
        where: { projectId },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.client.testCase.groupBy({
        by: ['suiteId'],
        where: { projectId, deletedAt: null },
        _count: true,
      }),
      this.prisma.client.testCase.count({ where: { projectId, deletedAt: null, suiteId: null } }),
    ]);
    const byId = new Map(counts.map((c) => [c.suiteId, c._count]));
    return {
      suites: suites.map((s) => ({ ...s, caseCount: byId.get(s.id) ?? 0 })),
      unsortedCount: unsorted,
    };
  }

  private async assertParent(
    tx: Prisma.TransactionClient,
    projectId: string,
    parentId: string | null | undefined,
    selfId?: string,
  ) {
    if (!parentId) return;
    const all = await tx.testSuite.findMany({
      where: { projectId },
      select: { id: true, parentId: true },
    });
    const map = new Map(all.map((s) => [s.id, s.parentId]));
    if (!map.has(parentId)) throw new BadRequestException('Parent suite not found');
    for (let c: string | null | undefined = parentId; c; c = map.get(c)) {
      if (c === selfId) throw new BadRequestException('Cannot move a suite inside itself');
    }
  }

  async create(ctx: ProjectCtx, input: CreateSuiteInput) {
    return this.prisma.client.$transaction(async (tx) => {
      await this.assertParent(tx, ctx.projectId, input.parentId);
      const last = await tx.testSuite.aggregate({
        where: { projectId: ctx.projectId, parentId: input.parentId ?? null },
        _max: { position: true },
      });
      const suite = await tx.testSuite.create({
        data: {
          projectId: ctx.projectId,
          name: input.name,
          description: input.description,
          parentId: input.parentId ?? null,
          position: (last._max.position ?? -1) + 1,
          createdById: ctx.actor.id,
        },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'test_suite',
        entityId: suite.id,
        action: 'create',
        after: { name: suite.name },
      });
      return suite;
    });
  }

  async update(ctx: ProjectCtx, id: string, input: Partial<CreateSuiteInput>) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.testSuite.findFirst({ where: { id, projectId: ctx.projectId } });
      if (!before) throw new NotFoundException('Suite not found');
      if (input.parentId !== undefined)
        await this.assertParent(tx, ctx.projectId, input.parentId, id);
      const suite = await tx.testSuite.update({
        where: { id },
        data: { name: input.name, description: input.description, parentId: input.parentId },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'test_suite',
        entityId: id,
        action: 'update',
        before,
        after: input,
      });
      return suite;
    });
  }

  async move(ctx: ProjectCtx, id: string, input: MoveInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const suite = await tx.testSuite.findFirst({ where: { id, projectId: ctx.projectId } });
      if (!suite) throw new NotFoundException('Suite not found');
      await this.assertParent(tx, ctx.projectId, input.parentId, id);
      const siblings = await tx.testSuite.findMany({
        where: { projectId: ctx.projectId, parentId: input.parentId, id: { not: id } },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        select: { id: true },
      });
      const order = siblings.map((s) => s.id);
      const at = input.beforeId ? order.indexOf(input.beforeId) : -1;
      order.splice(at === -1 ? order.length : at, 0, id);
      await Promise.all(
        order.map((sid, position) =>
          tx.testSuite.update({
            where: { id: sid },
            data: sid === id ? { position, parentId: input.parentId } : { position },
          }),
        ),
      );
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'test_suite',
        entityId: id,
        action: 'update',
        before: { parentId: suite.parentId },
        after: { parentId: input.parentId },
      });
      return { id, parentId: input.parentId };
    });
  }

  /** Deleting a suite moves its test cases (incl. from sub-suites) to the parent suite. */
  async remove(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const suite = await tx.testSuite.findFirst({ where: { id, projectId: ctx.projectId } });
      if (!suite) throw new NotFoundException('Suite not found');
      const all = await tx.testSuite.findMany({
        where: { projectId: ctx.projectId },
        select: { id: true, parentId: true },
      });
      const ids = new Set([id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const s of all)
          if (s.parentId && ids.has(s.parentId) && !ids.has(s.id)) (ids.add(s.id), (grew = true));
      }
      const moved = await tx.testCase.updateMany({
        where: { suiteId: { in: [...ids] } },
        data: { suiteId: suite.parentId },
      });
      await tx.testSuite.delete({ where: { id } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'test_suite',
        entityId: id,
        action: 'delete',
        metadata: { name: suite.name, movedCases: moved.count, removedSuites: ids.size },
      });
    });
  }
}

@ApiTags('test-suites')
@Controller('v1/projects/:projectId/suites')
export class SuitesController {
  constructor(private readonly suites: SuitesService) {}
  @Get() @RequirePermission('testcase:read') list(@Ctx() ctx: ProjectCtx) {
    return this.suites.list(ctx.projectId);
  }
  @Post() @RequirePermission('testcase:write') create(
    @Ctx() ctx: ProjectCtx,
    @Body() body: CreateSuiteDto,
  ) {
    return this.suites.create(ctx, body);
  }
  @Patch(':id') @RequirePermission('testcase:write') update(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSuiteDto,
  ) {
    return this.suites.update(ctx, id, body);
  }
  @Post(':id/move') @RequirePermission('testcase:write') move(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MoveDto,
  ) {
    return this.suites.move(ctx, id, body);
  }
  @Delete(':id') @HttpCode(204) @RequirePermission('testcase:write') async remove(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.suites.remove(ctx, id);
  }
}

@Module({ controllers: [SuitesController], providers: [SuitesService] })
export class SuitesModule {}
