import {
  BadRequestException,
  Controller,
  Get,
  Global,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Redirect,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { verifyFileToken, type Disposition } from '@qaforge/db';
import { Public, RequirePermission } from '../auth/decorators';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { AttachmentsService } from './attachments.service';
import { StorageService } from './storage.service';

@ApiTags('attachments')
@Controller('v1/projects/:projectId/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /** A short-lived URL for an <img src> or a download link. `?download=1` forces a download. */
  @Get(':id/url')
  @RequirePermission('project:read')
  async url(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('download') download?: string,
  ) {
    const a = await this.attachments.readable(ctx, id);
    return this.attachments.signedUrl(a, download === '1' ? 'attachment' : undefined);
  }

  /** Stable link for the UI: checks access, then redirects to a fresh signed URL. */
  @Get(':id/download')
  @RequirePermission('project:read')
  @Redirect()
  async download(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.attachments.readable(ctx, id);
    return { url: (await this.attachments.signedUrl(a)).url, statusCode: 302 };
  }
}

/** Serves signed URLs (local storage driver). No session needed: the signature is the grant. */
@ApiTags('attachments')
@Controller('v1/files')
export class SignedFilesController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get(':id')
  @Public()
  async serve(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('exp') exp: string,
    @Query('disp') disp: string,
    @Query('sig') sig: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (disp !== 'inline' && disp !== 'attachment') throw new BadRequestException('Invalid link');
    if (!sig || !verifyFileToken(id, Number(exp), disp as Disposition, sig))
      throw new NotFoundException('This link has expired. Open the file again from QAForge.');
    const { attachment, stream } = await this.attachments.openVerified(id);
    res.set({
      'Content-Type': attachment.contentType,
      'Content-Disposition': `${disp}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      // Only safe types render inline (decided when signing); nosniff + sandbox prevent type confusion.
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=60',
      'Referrer-Policy': 'no-referrer',
    });
    return new StreamableFile(stream);
  }
}

@Global()
@Module({
  controllers: [AttachmentsController, SignedFilesController],
  providers: [StorageService, AttachmentsService],
  exports: [StorageService, AttachmentsService],
})
export class StorageModule {}
