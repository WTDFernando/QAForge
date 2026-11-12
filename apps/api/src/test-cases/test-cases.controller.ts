import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import {
  bulkTestCaseSchema,
  type BulkTestCaseInput,
  createTestCaseSchema,
  setStatusSchema,
  testCaseQuerySchema,
  updateTestCaseSchema,
} from '@qaforge/shared';
import { RequirePermission } from '../auth/decorators';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { toCsv, toXlsx } from './export';
import { TestCasesService } from './test-cases.service';

class CreateTestCaseDto extends createZodDto(createTestCaseSchema) {}
class UpdateTestCaseDto extends createZodDto(updateTestCaseSchema) {}
class SetStatusDto extends createZodDto(setStatusSchema) {}
class ListQuery extends createZodDto(testCaseQuerySchema) {}
class ExportQuery extends createZodDto(
  testCaseQuerySchema
    .omit({ page: true, pageSize: true })
    .extend({ format: z.enum(['csv', 'xlsx']).default('csv') }),
) {}

@ApiTags('test-cases')
@Controller('v1/projects/:projectId/test-cases')
export class TestCasesController {
  constructor(private readonly tcs: TestCasesService) {}

  @Get()
  @RequirePermission('testcase:read')
  list(@Ctx() ctx: ProjectCtx, @Query() q: ListQuery) {
    return this.tcs.list(ctx.projectId, q);
  }

  @Get('export')
  @RequirePermission('testcase:read')
  async export(
    @Ctx() ctx: ProjectCtx,
    @Query() q: ExportQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rows = await this.tcs.listAll(ctx.projectId, q);
    const stamp = new Date().toISOString().slice(0, 10);
    if (q.format === 'xlsx') {
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="test-cases-${stamp}.xlsx"`,
      });
      return new StreamableFile(await toXlsx(rows));
    }
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="test-cases-${stamp}.csv"`,
    });
    return toCsv(rows);
  }

  @Get('tags')
  @RequirePermission('testcase:read')
  tags(@Ctx() ctx: ProjectCtx) {
    return this.tcs.tags(ctx.projectId);
  }

  @Post()
  @RequirePermission('testcase:write')
  create(@Ctx() ctx: ProjectCtx, @Body() body: CreateTestCaseDto) {
    return this.tcs.create(ctx, body);
  }

  /** Bulk edits. setStatus is allowed for approvers (e.g. Clients); other actions need testcase:write. */
  @Post('bulk')
  @RequirePermission('testcase:read')
  @ApiBody({ schema: z.toJSONSchema(bulkTestCaseSchema, { unrepresentable: 'any' }) as object })
  bulk(
    @Ctx() ctx: ProjectCtx,
    @Body(new ZodValidationPipe(bulkTestCaseSchema)) body: BulkTestCaseInput,
  ) {
    return this.tcs.bulk(ctx, body);
  }

  @Get(':id')
  @RequirePermission('testcase:read')
  get(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.tcs.get(ctx.projectId, id);
  }

  @Patch(':id')
  @RequirePermission('testcase:write')
  update(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateTestCaseDto,
  ) {
    return this.tcs.update(ctx, id, body);
  }

  @Post(':id/status')
  @RequirePermission('testcase:read')
  setStatus(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetStatusDto,
  ) {
    return this.tcs.setStatus(ctx, id, body.status, body.note);
  }

  @Get(':id/versions')
  @RequirePermission('testcase:read')
  versions(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.tcs.versions(ctx.projectId, id);
  }
}
