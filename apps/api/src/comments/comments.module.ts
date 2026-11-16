import {
  BadRequestException,
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
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  COMMENT_ENTITIES,
  createCommentSchema,
  formatRef,
  hasPermission,
  richTextToPlain,
  type CommentEntity,
  type CreateCommentInput,
} from '@qaforge/shared';
import type { Prisma } from '@qaforge/db';
import { RequirePermission } from '../auth/decorators';
import { AuditService } from '../audit/audit.service';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { NotificationsService } from '../notifications/notifications.module';
import { PrismaService } from '../prisma/prisma.module';

class CommentDto extends createZodDto(createCommentSchema) {}
class EditCommentDto extends createZodDto(createCommentSchema.pick({ body: true })) {}
const entityParam = z.enum(COMMENT_ENTITIES);
function parseEntity(entity: string): CommentEntity {
  const parsed = entityParam.safeParse(entity);
  if (!parsed.success) throw new BadRequestException('Unknown item type');
  return parsed.data;
}

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The commented item must exist in this project; returns its ref, title and people to notify. */
  private async target(projectId: string, entity: CommentEntity, id: string) {
    const db = this.prisma.client;
    if (entity === 'bug') {
      const b = await db.bug.findFirst({ where: { id, projectId, deletedAt: null } });
      if (b)
        return {
          ref: formatRef('bug', b.seq),
          title: b.title,
          watchers: [b.createdById, b.assigneeId].filter((x): x is string => !!x),
        };
    } else if (entity === 'test_case') {
      const t = await db.testCase.findFirst({ where: { id, projectId, deletedAt: null } });
      if (t)
        return { ref: formatRef('testCase', t.seq), title: t.title, watchers: [t.createdById] };
    } else {
      const r = await db.requirement.findFirst({ where: { id, projectId, deletedAt: null } });
      if (r)
        return { ref: formatRef('requirement', r.seq), title: r.title, watchers: [r.createdById] };
    }
    throw new NotFoundException('Item not found');
  }

  async list(projectId: string, entity: CommentEntity, id: string) {
    await this.target(projectId, entity, id);
    const rows = await this.prisma.client.comment.findMany({
      where: { projectId, entityType: entity, entityId: id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const authors = await this.prisma.client.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } },
      select: { id: true, name: true, image: true },
    });
    const byId = new Map(authors.map((a) => [a.id, a]));
    return rows.map((r) => ({
      ...r,
      author: byId.get(r.authorId) ?? { id: r.authorId, name: 'Former member', image: null },
    }));
  }

  async create(ctx: ProjectCtx, entity: CommentEntity, id: string, input: CreateCommentInput) {
    const t = await this.target(ctx.projectId, entity, id);
    const bodyText = richTextToPlain(input.body);
    if (!bodyText.trim()) throw new BadRequestException('Comment is empty');
    return this.prisma.client.$transaction(async (tx) => {
      const mentions = input.mentions.length
        ? (
            await tx.membership.findMany({
              where: { organizationId: ctx.organizationId, userId: { in: input.mentions } },
              select: { userId: true },
            })
          ).map((m) => m.userId)
        : [];
      const c = await tx.comment.create({
        data: {
          projectId: ctx.projectId,
          entityType: entity,
          entityId: id,
          body: input.body as Prisma.InputJsonValue,
          bodyText,
          mentions,
          authorId: ctx.actor.id,
        },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: entity,
        entityId: id,
        action: 'comment',
        metadata: { commentId: c.id },
      });
      const excerpt = bodyText.slice(0, 140);
      await this.notifications.notify(
        {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          userIds: mentions,
          actorId: ctx.actor.id,
          type: 'mention',
          title: `You were mentioned on ${t.ref}`,
          body: excerpt,
          entityType: entity,
          entityId: id,
        },
        tx,
      );
      await this.notifications.notify(
        {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          userIds: t.watchers.filter((w) => !mentions.includes(w)),
          actorId: ctx.actor.id,
          type: 'comment',
          title: `New comment on ${t.ref}`,
          body: excerpt,
          entityType: entity,
          entityId: id,
        },
        tx,
      );
      return c;
    });
  }

  async edit(ctx: ProjectCtx, commentId: string, body: CreateCommentInput['body']) {
    const c = await this.prisma.client.comment.findFirst({
      where: { id: commentId, projectId: ctx.projectId, deletedAt: null },
    });
    if (!c) throw new NotFoundException('Comment not found');
    if (c.authorId !== ctx.actor.id)
      throw new ForbiddenException('You can only edit your own comments');
    return this.prisma.client.comment.update({
      where: { id: commentId },
      data: {
        body: body as Prisma.InputJsonValue,
        bodyText: richTextToPlain(body),
        editedAt: new Date(),
      },
    });
  }

  async remove(ctx: ProjectCtx, commentId: string) {
    const c = await this.prisma.client.comment.findFirst({
      where: { id: commentId, projectId: ctx.projectId, deletedAt: null },
    });
    if (!c) throw new NotFoundException('Comment not found');
    if (c.authorId !== ctx.actor.id && !hasPermission(ctx.role, 'project:update'))
      throw new ForbiddenException('You can only delete your own comments');
    await this.prisma.client.$transaction(async (tx) => {
      await tx.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'comment',
        entityId: commentId,
        action: 'delete',
        metadata: { on: c.entityType, entityId: c.entityId },
      });
    });
  }
}

@ApiTags('comments')
@Controller('v1/projects/:projectId')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('comments/:entity/:entityId')
  @RequirePermission('project:read')
  list(
    @Ctx() ctx: ProjectCtx,
    @Param('entity') entity: string,
    @Param('entityId', ParseUUIDPipe) id: string,
  ) {
    return this.comments.list(ctx.projectId, parseEntity(entity), id);
  }

  @Post('comments/:entity/:entityId')
  @RequirePermission('comment:write')
  create(
    @Ctx() ctx: ProjectCtx,
    @Param('entity') entity: string,
    @Param('entityId', ParseUUIDPipe) id: string,
    @Body() body: CommentDto,
  ) {
    return this.comments.create(ctx, parseEntity(entity), id, body);
  }

  @Patch('comments/:commentId')
  @RequirePermission('comment:write')
  edit(
    @Ctx() ctx: ProjectCtx,
    @Param('commentId', ParseUUIDPipe) id: string,
    @Body() body: EditCommentDto,
  ) {
    return this.comments.edit(ctx, id, body.body);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  @RequirePermission('comment:write')
  async remove(@Ctx() ctx: ProjectCtx, @Param('commentId', ParseUUIDPipe) id: string) {
    await this.comments.remove(ctx, id);
  }
}

@Module({ controllers: [CommentsController], providers: [CommentsService] })
export class CommentsModule {}
