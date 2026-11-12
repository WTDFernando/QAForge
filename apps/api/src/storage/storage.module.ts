import {
  Controller,
  Get,
  Global,
  Module,
  Param,
  ParseUUIDPipe,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermission } from '../auth/decorators';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { AttachmentsService } from './attachments.service';
import { StorageService } from './storage.service';

const INLINE = /^(image\/(png|jpeg|webp)|application\/pdf|text\/plain)$/;

@ApiTags('attachments')
@Controller('v1/projects/:projectId/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get(':id/download')
  @RequirePermission('project:read')
  async download(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { attachment, stream } = await this.attachments.open(ctx.projectId, id);
    // Only safe types render inline; everything else downloads. nosniff prevents type confusion.
    const disposition = INLINE.test(attachment.contentType) ? 'inline' : 'attachment';
    res.set({
      'Content-Type': attachment.contentType,
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    return new StreamableFile(stream);
  }
}

@Global()
@Module({
  controllers: [AttachmentsController],
  providers: [StorageService, AttachmentsService],
  exports: [StorageService, AttachmentsService],
})
export class StorageModule {}
