import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  createLinkSourceSchema,
  createRequirementSchema,
  linkSchema,
  MAX_UPLOAD_BYTES,
  moveSchema,
  updateRequirementSchema,
} from '@qaforge/shared';
import { RequirePermission } from '../auth/decorators';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import type { UploadedFileLike } from '../storage/attachments.service';
import { RequirementsService } from './requirements.service';
import { SourcesService } from './sources.service';

class CreateRequirementDto extends createZodDto(createRequirementSchema) {}
class UpdateRequirementDto extends createZodDto(updateRequirementSchema) {}
class MoveDto extends createZodDto(moveSchema) {}
class LinkDto extends createZodDto(linkSchema) {}
class LinkSourceDto extends createZodDto(createLinkSourceSchema) {}

@ApiTags('requirements')
@Controller('v1/projects/:projectId/requirements')
export class RequirementsController {
  constructor(private readonly reqs: RequirementsService) {}

  @Get()
  @RequirePermission('requirement:read')
  list(@Ctx() ctx: ProjectCtx) {
    return this.reqs.list(ctx.projectId);
  }

  @Post()
  @RequirePermission('requirement:write')
  create(@Ctx() ctx: ProjectCtx, @Body() body: CreateRequirementDto) {
    return this.reqs.create(ctx, body);
  }

  @Post('restore')
  @RequirePermission('requirement:write')
  restore(@Ctx() ctx: ProjectCtx, @Body() body: LinkDto) {
    return this.reqs.restore(ctx, body.ids);
  }

  @Get(':id')
  @RequirePermission('requirement:read')
  get(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.reqs.get(ctx.projectId, id);
  }

  @Patch(':id')
  @RequirePermission('requirement:write')
  update(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRequirementDto,
  ) {
    return this.reqs.update(ctx, id, body);
  }

  @Post(':id/move')
  @RequirePermission('requirement:write')
  move(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string, @Body() body: MoveDto) {
    return this.reqs.move(ctx, id, body);
  }

  @Delete(':id')
  @RequirePermission('requirement:write')
  remove(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.reqs.remove(ctx, id);
  }

  @Get(':id/versions')
  @RequirePermission('requirement:read')
  versions(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.reqs.versions(ctx.projectId, id);
  }

  @Post(':id/test-cases')
  @RequirePermission('testcase:write')
  link(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string, @Body() body: LinkDto) {
    return this.reqs.link(ctx, id, body.ids);
  }

  @Delete(':id/test-cases/:testCaseId')
  @HttpCode(204)
  @RequirePermission('testcase:write')
  async unlink(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('testCaseId', ParseUUIDPipe) tcId: string,
  ) {
    await this.reqs.unlink(ctx, id, tcId);
  }
}

@ApiTags('requirements')
@Controller('v1/projects/:projectId/requirement-sources')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Get()
  @RequirePermission('requirement:read')
  list(@Ctx() ctx: ProjectCtx) {
    return this.sources.list(ctx.projectId);
  }

  @Post('upload')
  @RequirePermission('requirement:write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@Ctx() ctx: ProjectCtx, @UploadedFile() file: UploadedFileLike) {
    return this.sources.upload(ctx, file);
  }

  @Post('link')
  @RequirePermission('requirement:write')
  addLink(@Ctx() ctx: ProjectCtx, @Body() body: LinkSourceDto) {
    return this.sources.addLink(ctx, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('requirement:write')
  async remove(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.sources.remove(ctx, id);
  }
}

@Module({
  controllers: [RequirementsController, SourcesController],
  providers: [RequirementsService, SourcesService],
  exports: [RequirementsService],
})
export class RequirementsModule {}
