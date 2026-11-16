import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import {
  addRunCasesSchema,
  assignResultsSchema,
  createTestRunSchema,
  recordResultSchema,
  runListQuerySchema,
  runResultsQuerySchema,
  updateTestRunSchema,
  type CreateTestRunInput,
} from '@qaforge/shared';
import { RequirePermission } from '../auth/decorators';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { TestCasesModule } from '../test-cases/test-cases.module';
import { TestRunsService } from './test-runs.service';

class UpdateRunDto extends createZodDto(updateTestRunSchema) {}
class RecordDto extends createZodDto(recordResultSchema) {}
class AssignDto extends createZodDto(assignResultsSchema) {}
class AddCasesDto extends createZodDto(addRunCasesSchema) {}
class ListQuery extends createZodDto(runListQuerySchema) {}
class ResultsQuery extends createZodDto(runResultsQuerySchema) {}

@ApiTags('test-runs')
@Controller('v1/projects/:projectId')
export class TestRunsController {
  constructor(private readonly runs: TestRunsService) {}

  @Get('test-runs')
  @RequirePermission('run:read')
  list(@Ctx() ctx: ProjectCtx, @Query() q: ListQuery) {
    return this.runs.list(ctx.projectId, q);
  }

  @Post('test-runs')
  @RequirePermission('run:create')
  @ApiBody({ schema: z.toJSONSchema(createTestRunSchema, { unrepresentable: 'any' }) as object })
  create(
    @Ctx() ctx: ProjectCtx,
    @Body(new ZodValidationPipe(createTestRunSchema)) body: CreateTestRunInput,
  ) {
    return this.runs.create(ctx, body);
  }

  @Get('test-runs/by-ref/:seq')
  @RequirePermission('run:read')
  byRef(@Ctx() ctx: ProjectCtx, @Param('seq', ParseIntPipe) seq: number) {
    return this.runs.getByRef(ctx.projectId, seq);
  }

  @Get('test-runs/:id')
  @RequirePermission('run:read')
  get(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.get(ctx.projectId, id);
  }

  @Patch('test-runs/:id')
  @RequirePermission('run:create')
  update(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRunDto,
  ) {
    return this.runs.update(ctx, id, body);
  }

  @Delete('test-runs/:id')
  @HttpCode(204)
  @RequirePermission('run:create')
  async remove(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.runs.remove(ctx, id);
  }

  @Post('test-runs/:id/cases')
  @RequirePermission('run:create')
  addCases(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddCasesDto,
  ) {
    return this.runs.addCases(ctx, id, body.testCaseIds);
  }

  @Post('test-runs/:id/assign')
  @RequirePermission('run:create')
  assign(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string, @Body() body: AssignDto) {
    return this.runs.assign(ctx, id, body.resultIds, body.assigneeId);
  }

  @Get('test-runs/:id/results')
  @RequirePermission('run:read')
  results(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ResultsQuery,
  ) {
    return this.runs.results(ctx.projectId, id, ctx.actor.id, q);
  }

  @Get('run-results/:resultId')
  @RequirePermission('run:read')
  result(@Ctx() ctx: ProjectCtx, @Param('resultId', ParseUUIDPipe) id: string) {
    return this.runs.result(ctx.projectId, id);
  }

  @Patch('run-results/:resultId')
  @RequirePermission('run:execute')
  record(
    @Ctx() ctx: ProjectCtx,
    @Param('resultId', ParseUUIDPipe) id: string,
    @Body() body: RecordDto,
  ) {
    return this.runs.record(ctx, id, body);
  }
}

@Module({
  imports: [TestCasesModule],
  controllers: [TestRunsController],
  providers: [TestRunsService],
  exports: [TestRunsService],
})
export class TestRunsModule {}
