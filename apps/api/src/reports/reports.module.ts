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
  Query,
  Redirect,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import {
  createReportSchema,
  reportScheduleSchema,
  shareReportSchema,
  updateReportScheduleSchema,
  type CreateReportInput,
  type ReportScheduleInput,
} from '@qaforge/shared';
import { Public, RequirePermission } from '../auth/decorators';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { ReportsService } from './reports.service';

const schemaBody = (s: z.ZodType) =>
  ApiBody({ schema: z.toJSONSchema(s, { unrepresentable: 'any' }) as object });
const pipe = (s: z.ZodType) => new ZodValidationPipe(s);

@ApiTags('reports')
@Controller('v1/projects/:projectId')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports')
  @RequirePermission('report:read')
  list(@Ctx() ctx: ProjectCtx, @Query('releaseId') releaseId?: string) {
    return this.reports.list(
      ctx.projectId,
      releaseId && /^[0-9a-f-]{36}$/i.test(releaseId) ? releaseId : undefined,
    );
  }

  @Get('reports/:id')
  @RequirePermission('report:read')
  get(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.get(ctx.projectId, id);
  }

  /** Numbers are computed by the worker from the database; poll until status is READY. */
  @Post('reports')
  @RequirePermission('report:write')
  @schemaBody(createReportSchema)
  create(@Ctx() ctx: ProjectCtx, @Body(pipe(createReportSchema)) body: CreateReportInput) {
    return this.reports.create(ctx, body);
  }

  @Delete('reports/:id')
  @HttpCode(204)
  @RequirePermission('report:write')
  async remove(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.reports.remove(ctx, id);
  }

  /** Read-only link that works without signing in. The token is shown once. */
  @Post('reports/:id/share')
  @RequirePermission('report:share')
  @schemaBody(shareReportSchema)
  share(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(pipe(shareReportSchema)) body: { expiresInDays: number },
  ) {
    return this.reports.share(ctx, id, body.expiresInDays);
  }

  @Delete('reports/:id/share')
  @HttpCode(204)
  @RequirePermission('report:share')
  async unshare(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.reports.unshare(ctx, id);
  }

  @Get('report-schedules')
  @RequirePermission('report:read')
  schedules(@Ctx() ctx: ProjectCtx) {
    return this.reports.schedules(ctx.projectId);
  }

  @Post('report-schedules')
  @RequirePermission('report:schedule')
  @schemaBody(reportScheduleSchema)
  createSchedule(
    @Ctx() ctx: ProjectCtx,
    @Body(pipe(reportScheduleSchema)) body: ReportScheduleInput,
  ) {
    return this.reports.createSchedule(ctx, body);
  }

  @Patch('report-schedules/:id')
  @RequirePermission('report:schedule')
  @schemaBody(updateReportScheduleSchema)
  updateSchedule(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(pipe(updateReportScheduleSchema)) body: Partial<ReportScheduleInput>,
  ) {
    return this.reports.updateSchedule(ctx, id, body);
  }

  @Delete('report-schedules/:id')
  @HttpCode(204)
  @RequirePermission('report:schedule')
  async deleteSchedule(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.reports.deleteSchedule(ctx, id);
  }
}

/** Shared report links: no session; the token is the grant (rate-limited like the rest of the API). */
@ApiTags('reports')
@Controller('v1/share/reports')
export class SharedReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':token')
  @Public()
  view(@Param('token') token: string) {
    return this.reports.publicView(token);
  }

  @Get(':token/files/:format')
  @Public()
  @Redirect()
  async file(@Param('token') token: string, @Param('format') format: string) {
    return { url: (await this.reports.publicFile(token, format)).url, statusCode: 302 };
  }
}

@Module({
  controllers: [ReportsController, SharedReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
