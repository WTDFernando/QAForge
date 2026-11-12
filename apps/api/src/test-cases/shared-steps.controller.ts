import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { patchOf, sharedStepSchema, type SharedStepInput } from '@qaforge/shared';
import { RequirePermission } from '../auth/decorators';
import { AuditService } from '../audit/audit.service';
import { rethrowUnique } from '../common/errors';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { PrismaService } from '../prisma/prisma.module';

class SharedStepDto extends createZodDto(sharedStepSchema) {}
class UpdateSharedStepDto extends createZodDto(patchOf(sharedStepSchema)) {}

@Injectable()
export class SharedStepsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(projectId: string) {
    const rows = await this.prisma.client.sharedStep.findMany({
      where: { projectId },
      include: { _count: { select: { usages: { where: { testCase: { deletedAt: null } } } } } },
      orderBy: { name: 'asc' },
    });
    return rows.map(({ _count, ...r }) => ({ ...r, usageCount: _count.usages }));
  }

  async create(ctx: ProjectCtx, input: SharedStepInput) {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const s = await tx.sharedStep.create({
          data: {
            projectId: ctx.projectId,
            name: input.name,
            steps: input.steps,
            createdById: ctx.actor.id,
          },
        });
        await this.audit.record(tx, ctx.actor, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          entityType: 'shared_step',
          entityId: s.id,
          action: 'create',
          after: { name: s.name },
        });
        return s;
      });
    } catch (e) {
      rethrowUnique(e, `A shared step named "${input.name}" already exists`);
    }
  }

  async update(ctx: ProjectCtx, id: string, input: Partial<SharedStepInput>) {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const before = await tx.sharedStep.findFirst({ where: { id, projectId: ctx.projectId } });
        if (!before) throw new NotFoundException('Shared step not found');
        const s = await tx.sharedStep.update({
          where: { id },
          data: { name: input.name, steps: input.steps },
        });
        await this.audit.record(tx, ctx.actor, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          entityType: 'shared_step',
          entityId: id,
          action: 'update',
          before,
          after: input,
        });
        return s;
      });
    } catch (e) {
      rethrowUnique(e, `A shared step named "${input.name}" already exists`);
    }
  }

  async remove(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const s = await tx.sharedStep.findFirst({
        where: { id, projectId: ctx.projectId },
        include: { _count: { select: { usages: true } } },
      });
      if (!s) throw new NotFoundException('Shared step not found');
      if (s._count.usages > 0)
        throw new BadRequestException(
          `Used by ${s._count.usages} test step(s); remove those first`,
        );
      await tx.sharedStep.delete({ where: { id } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'shared_step',
        entityId: id,
        action: 'delete',
        metadata: { name: s.name },
      });
    });
  }
}

@ApiTags('test-cases')
@Controller('v1/projects/:projectId/shared-steps')
export class SharedStepsController {
  constructor(private readonly svc: SharedStepsService) {}
  @Get() @RequirePermission('testcase:read') list(@Ctx() ctx: ProjectCtx) {
    return this.svc.list(ctx.projectId);
  }
  @Post() @RequirePermission('testcase:write') create(
    @Ctx() ctx: ProjectCtx,
    @Body() body: SharedStepDto,
  ) {
    return this.svc.create(ctx, body);
  }
  @Patch(':id') @RequirePermission('testcase:write') update(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSharedStepDto,
  ) {
    return this.svc.update(ctx, id, body);
  }
  @Delete(':id') @HttpCode(204) @RequirePermission('testcase:write') async remove(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.svc.remove(ctx, id);
  }
}
