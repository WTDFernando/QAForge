import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import {
  bugQuerySchema,
  createBugSchema,
  MAX_UPLOAD_BYTES,
  setBugStatusSchema,
  updateBugSchema,
  type SetBugStatusInput,
} from '@qaforge/shared';
import type { Prisma } from '@qaforge/db';
import { RequirePermission } from '../auth/decorators';
import { AuditService } from '../audit/audit.service';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { PrismaService } from '../prisma/prisma.module';
import { AttachmentsService, type UploadedFileLike } from '../storage/attachments.service';
import { BugsService } from './bugs.service';

class CreateBugDto extends createZodDto(createBugSchema) {}
class UpdateBugDto extends createZodDto(updateBugSchema) {}
class BugQuery extends createZodDto(bugQuerySchema) {}
class BoardQuery extends createZodDto(
  bugQuerySchema.omit({ page: true, pageSize: true, sort: true, dir: true }),
) {}
class SimilarQuery extends createZodDto(
  z.object({ title: z.string().max(300), excludeId: z.uuid().optional() }),
) {}

/** Evidence types for bugs and run results: screenshots, recordings, logs. */
export const EVIDENCE_TYPES: Record<string, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
  'video/mp4': 'MP4',
  'video/webm': 'WebM',
  'text/plain': 'Text/log',
  'application/json': 'JSON/HAR',
  'application/pdf': 'PDF',
};

/** Highlight boxes, normalized to the image (0-1). */
export const annotationsSchema = z
  .array(
    z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      w: z.number().min(0).max(1),
      h: z.number().min(0).max(1),
      label: z.string().max(200).default(''),
      source: z.enum(['ai', 'user']).default('user'),
    }),
  )
  .max(20);
class AnnotationsDto extends createZodDto(z.object({ annotations: annotationsSchema })) {}

function parseAnnotations(raw: unknown) {
  if (raw === undefined || raw === '') return undefined;
  try {
    return annotationsSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch {
    throw new BadRequestException('Invalid annotations');
  }
}

@ApiTags('bugs')
@Controller('v1/projects/:projectId')
export class BugsController {
  constructor(
    private readonly bugs: BugsService,
    private readonly attachments: AttachmentsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('bugs')
  @RequirePermission('bug:read')
  list(@Ctx() ctx: ProjectCtx, @Query() q: BugQuery) {
    return this.bugs.list(ctx.projectId, ctx.actor.id, q);
  }

  @Get('bugs/board')
  @RequirePermission('bug:read')
  board(@Ctx() ctx: ProjectCtx, @Query() q: BoardQuery) {
    return this.bugs.board(ctx.projectId, ctx.actor.id, q);
  }

  @Get('bugs/components')
  @RequirePermission('bug:read')
  components(@Ctx() ctx: ProjectCtx) {
    return this.bugs.components(ctx.projectId);
  }

  @Get('bugs/similar')
  @RequirePermission('bug:read')
  similar(@Ctx() ctx: ProjectCtx, @Query() q: SimilarQuery) {
    return this.bugs.similar(ctx.projectId, q.title, q.excludeId);
  }

  @Post('bugs')
  @RequirePermission('bug:write')
  create(@Ctx() ctx: ProjectCtx, @Body() body: CreateBugDto) {
    return this.bugs.create(ctx, body);
  }

  @Get('bugs/by-ref/:seq')
  @RequirePermission('bug:read')
  byRef(@Ctx() ctx: ProjectCtx, @Param('seq', ParseIntPipe) seq: number) {
    return this.bugs.getByRef(ctx.projectId, seq);
  }

  @Get('bugs/:id')
  @RequirePermission('bug:read')
  get(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.bugs.get(ctx.projectId, id);
  }

  @Patch('bugs/:id')
  @RequirePermission('bug:write')
  update(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBugDto,
  ) {
    return this.bugs.update(ctx, id, body);
  }

  @Post('bugs/:id/status')
  @HttpCode(200)
  @RequirePermission('bug:write')
  @ApiBody({ schema: z.toJSONSchema(setBugStatusSchema, { unrepresentable: 'any' }) as object })
  status(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setBugStatusSchema)) body: SetBugStatusInput,
  ) {
    return this.bugs.setStatus(ctx, id, body);
  }

  @Delete('bugs/:id')
  @HttpCode(204)
  @RequirePermission('bug:write')
  async remove(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.bugs.remove(ctx, id);
  }

  @Post('bugs/:id/restore')
  @HttpCode(204)
  @RequirePermission('bug:write')
  async restore(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.bugs.restore(ctx, id);
  }

  /** Evidence upload (multipart: file + optional `annotations` JSON). */
  @Post('bugs/:id/attachments')
  @RequirePermission('bug:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async attachToBug(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike,
    @Body() body: { annotations?: string },
  ) {
    const bug = await this.prisma.client.bug.findFirst({
      where: { id, projectId: ctx.projectId, deletedAt: null },
    });
    if (!bug) throw new NotFoundException('Bug not found');
    const annotations = parseAnnotations(body?.annotations);
    return this.prisma.client.$transaction(async (tx) => {
      const a = await this.attachments.store(tx, ctx, file, EVIDENCE_TYPES, {
        entityType: 'bug',
        entityId: id,
      });
      const saved = annotations
        ? await tx.attachment.update({
            where: { id: a.id },
            data: { annotations: annotations as Prisma.InputJsonValue },
          })
        : a;
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'bug',
        entityId: id,
        action: 'attach',
        metadata: { attachmentId: a.id, fileName: a.fileName },
      });
      return saved;
    });
  }

  @Post('run-results/:resultId/attachments')
  @RequirePermission('run:execute')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async attachToResult(
    @Ctx() ctx: ProjectCtx,
    @Param('resultId', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike,
  ) {
    const r = await this.prisma.client.testRunResult.findFirst({
      where: { id, testRun: { projectId: ctx.projectId, deletedAt: null } },
    });
    if (!r) throw new NotFoundException('Result not found');
    return this.prisma.client.$transaction((tx) =>
      this.attachments.store(tx, ctx, file, EVIDENCE_TYPES, {
        entityType: 'test_run_result',
        entityId: id,
      }),
    );
  }

  @Get('run-results/:resultId/attachments')
  @RequirePermission('run:read')
  async resultAttachments(@Ctx() ctx: ProjectCtx, @Param('resultId', ParseUUIDPipe) id: string) {
    return this.prisma.client.attachment.findMany({
      where: { projectId: ctx.projectId, entityType: 'test_run_result', entityId: id },
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
  }

  @Patch('attachments/:attachmentId/annotations')
  @RequirePermission('bug:write')
  async annotate(
    @Ctx() ctx: ProjectCtx,
    @Param('attachmentId', ParseUUIDPipe) id: string,
    @Body() body: AnnotationsDto,
  ) {
    const a = await this.prisma.client.attachment.findFirst({
      where: { id, projectId: ctx.projectId, entityType: 'bug' },
    });
    if (!a) throw new NotFoundException('File not found');
    return this.prisma.client.attachment.update({
      where: { id },
      data: { annotations: body.annotations as Prisma.InputJsonValue },
    });
  }
}

@Module({ controllers: [BugsController], providers: [BugsService], exports: [BugsService] })
export class BugsModule {}
