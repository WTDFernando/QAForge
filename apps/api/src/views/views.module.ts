import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  hasPermission,
  SAVED_VIEW_ENTITIES,
  savedViewSchema,
  type SavedViewInput,
} from '@qaforge/shared';
import type { Prisma } from '@qaforge/db';
import { RequirePermission } from '../auth/decorators';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { PrismaService } from '../prisma/prisma.module';

class SavedViewDto extends createZodDto(savedViewSchema) {}
class ViewsQuery extends createZodDto(z.object({ entity: z.enum(SAVED_VIEW_ENTITIES) })) {}

/** Personal or project-shared list views. UI preferences, so not audited. */
@Injectable()
export class ViewsService {
  constructor(private readonly prisma: PrismaService) {}

  list(ctx: ProjectCtx, entity: string) {
    return this.prisma.client.savedView.findMany({
      where: {
        projectId: ctx.projectId,
        entity,
        OR: [{ ownerId: ctx.actor.id }, { shared: true }],
      },
      orderBy: [{ shared: 'asc' }, { name: 'asc' }],
    });
  }

  create(ctx: ProjectCtx, input: SavedViewInput) {
    if (input.shared && !hasPermission(ctx.role, 'testcase:write'))
      throw new ForbiddenException('Only editors can share views');
    return this.prisma.client.savedView.create({
      data: {
        projectId: ctx.projectId,
        ownerId: ctx.actor.id,
        entity: input.entity,
        name: input.name,
        config: input.config as Prisma.InputJsonValue,
        shared: input.shared,
      },
    });
  }

  async remove(ctx: ProjectCtx, id: string) {
    const v = await this.prisma.client.savedView.findFirst({
      where: { id, projectId: ctx.projectId },
    });
    if (!v || (v.ownerId !== ctx.actor.id && !v.shared))
      throw new NotFoundException('View not found');
    if (v.ownerId !== ctx.actor.id && !hasPermission(ctx.role, 'project:update'))
      throw new ForbiddenException('Only the owner or a QA Lead can delete this view');
    await this.prisma.client.savedView.delete({ where: { id } });
  }
}

@ApiTags('saved-views')
@Controller('v1/projects/:projectId/views')
export class ViewsController {
  constructor(private readonly views: ViewsService) {}
  @Get() @RequirePermission('project:read') list(@Ctx() ctx: ProjectCtx, @Query() q: ViewsQuery) {
    return this.views.list(ctx, q.entity);
  }
  @Post() @RequirePermission('project:read') create(
    @Ctx() ctx: ProjectCtx,
    @Body() body: SavedViewDto,
  ) {
    return this.views.create(ctx, body);
  }
  @Delete(':id') @HttpCode(204) @RequirePermission('project:read') async remove(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.views.remove(ctx, id);
  }
}

@Module({ controllers: [ViewsController], providers: [ViewsService] })
export class ViewsModule {}
