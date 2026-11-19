import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
import { ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import {
  apiCollectionSchema,
  apiRequestSchema,
  automationScheduleSchema,
  automationTestSchema,
  ciTriggerSchema,
  createProjectTokenSchema,
  importCollectionSchema,
  sendApiRequestSchema,
  startAutomationRunSchema,
  updateApiCollectionSchema,
  updateApiRequestSchema,
  updateAutomationScheduleSchema,
  updateAutomationTestSchema,
  type ApiCollectionInput,
  type ApiRequestInput,
  type AutomationScheduleInput,
  type AutomationTestInput,
  type CiTriggerInput,
  type ImportCollectionInput,
  type SendApiRequestInput,
  type StartAutomationRunInput,
} from '@qaforge/shared';
import { Public, RequirePermission } from '../auth/decorators';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { ApiCollectionsService } from './api-collections.service';
import { AutomationRunsService } from './automation-runs.service';
import { AutomationTestsService } from './automation-tests.service';

const schemaBody = (s: z.ZodType) =>
  ApiBody({ schema: z.toJSONSchema(s, { unrepresentable: 'any' }) as object });
const pipe = (s: z.ZodType) => new ZodValidationPipe(s);

@ApiTags('automation')
@Controller('v1/projects/:projectId')
export class ApiTestingController {
  constructor(private readonly api: ApiCollectionsService) {}

  @Get('api-collections')
  @RequirePermission('automation:read')
  tree(@Ctx() ctx: ProjectCtx) {
    return this.api.tree(ctx.projectId);
  }

  @Post('api-collections')
  @RequirePermission('automation:write')
  @schemaBody(apiCollectionSchema)
  createCollection(
    @Ctx() ctx: ProjectCtx,
    @Body(pipe(apiCollectionSchema)) body: ApiCollectionInput,
  ) {
    return this.api.createCollection(ctx, body);
  }

  @Patch('api-collections/:id')
  @RequirePermission('automation:write')
  @schemaBody(updateApiCollectionSchema)
  updateCollection(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(pipe(updateApiCollectionSchema)) body: Partial<ApiCollectionInput>,
  ) {
    return this.api.updateCollection(ctx, id, body);
  }

  @Delete('api-collections/:id')
  @HttpCode(204)
  @RequirePermission('automation:write')
  async deleteCollection(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.api.deleteCollection(ctx, id);
  }

  @Post('api-collections/import')
  @RequirePermission('automation:write')
  @schemaBody(importCollectionSchema)
  import(@Ctx() ctx: ProjectCtx, @Body(pipe(importCollectionSchema)) body: ImportCollectionInput) {
    return this.api.import(ctx, body);
  }

  @Get('api-requests/:id')
  @RequirePermission('automation:read')
  request(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.api.request(ctx.projectId, id);
  }

  @Post('api-requests')
  @RequirePermission('automation:write')
  @schemaBody(apiRequestSchema)
  createRequest(@Ctx() ctx: ProjectCtx, @Body(pipe(apiRequestSchema)) body: ApiRequestInput) {
    return this.api.createRequest(ctx, body);
  }

  @Patch('api-requests/:id')
  @RequirePermission('automation:write')
  @schemaBody(updateApiRequestSchema)
  updateRequest(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(pipe(updateApiRequestSchema)) body: Partial<ApiRequestInput>,
  ) {
    return this.api.updateRequest(ctx, id, body);
  }

  @Delete('api-requests/:id')
  @HttpCode(204)
  @RequirePermission('automation:write')
  async deleteRequest(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.api.deleteRequest(ctx, id);
  }

  /** Execute a request from the editor. Requests go out from the server, with the SSRF guard. */
  @Post('api-requests/send')
  @HttpCode(200)
  @RequirePermission('automation:run')
  @schemaBody(sendApiRequestSchema)
  send(@Ctx() ctx: ProjectCtx, @Body(pipe(sendApiRequestSchema)) body: SendApiRequestInput) {
    return this.api.send(ctx, body);
  }
}

@ApiTags('automation')
@Controller('v1/projects/:projectId')
export class AutomationTestsController {
  constructor(private readonly tests: AutomationTestsService) {}

  @Get('automation-tests')
  @RequirePermission('automation:read')
  list(@Ctx() ctx: ProjectCtx) {
    return this.tests.list(ctx.projectId);
  }

  @Get('automation-tests/:id')
  @RequirePermission('automation:read')
  get(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.tests.get(ctx.projectId, id);
  }

  @Get('automation-tests/:id/versions/:version')
  @RequirePermission('automation:read')
  version(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.tests.version(ctx.projectId, id, version);
  }

  @Post('automation-tests')
  @RequirePermission('automation:write')
  @schemaBody(automationTestSchema)
  create(@Ctx() ctx: ProjectCtx, @Body(pipe(automationTestSchema)) body: AutomationTestInput) {
    return this.tests.create(ctx, body);
  }

  @Patch('automation-tests/:id')
  @RequirePermission('automation:write')
  @schemaBody(updateAutomationTestSchema)
  update(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(pipe(updateAutomationTestSchema))
    body: Partial<AutomationTestInput> & { version?: number },
  ) {
    return this.tests.update(ctx, id, body);
  }

  @Delete('automation-tests/:id')
  @HttpCode(204)
  @RequirePermission('automation:write')
  async remove(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.tests.remove(ctx, id);
  }

  /** Approve or dismiss the Automation Agent's suggested locator fix. */
  @Post('automation-tests/:id/fix/:decision')
  @HttpCode(200)
  @RequirePermission('automation:write')
  resolveFix(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('decision') decision: string,
  ) {
    return this.tests.resolveFix(ctx, id, decision === 'approve');
  }
}

@ApiTags('automation')
@Controller('v1/projects/:projectId')
export class AutomationRunsController {
  constructor(private readonly runs: AutomationRunsService) {}

  @Get('automation-runs')
  @RequirePermission('automation:read')
  list(@Ctx() ctx: ProjectCtx, @Query('limit') limit?: string) {
    return this.runs.list(ctx.projectId, Number(limit) || 50);
  }

  @Post('automation-runs')
  @RequirePermission('automation:run')
  @schemaBody(startAutomationRunSchema)
  start(
    @Ctx() ctx: ProjectCtx,
    @Body(pipe(startAutomationRunSchema)) body: StartAutomationRunInput,
  ) {
    return this.runs.start(ctx, body);
  }

  /** By id or by ref (AUT-0001). */
  @Get('automation-runs/:idOrRef')
  @RequirePermission('automation:read')
  get(@Ctx() ctx: ProjectCtx, @Param('idOrRef') idOrRef: string) {
    return this.runs.get(ctx.projectId, idOrRef);
  }

  @Post('automation-runs/:id/cancel')
  @HttpCode(200)
  @RequirePermission('automation:run')
  cancel(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.cancel(ctx, id);
  }

  @Get('automation-results/:id')
  @RequirePermission('automation:read')
  result(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.result(ctx.projectId, id);
  }

  @Get('automation-results/:id/bug-draft')
  @RequirePermission('bug:write')
  bugDraft(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.bugDraft(ctx.projectId, id);
  }

  @Get('automation-schedules')
  @RequirePermission('automation:read')
  schedules(@Ctx() ctx: ProjectCtx) {
    return this.runs.schedules(ctx.projectId);
  }

  @Post('automation-schedules')
  @RequirePermission('automation:configure')
  @schemaBody(automationScheduleSchema)
  createSchedule(
    @Ctx() ctx: ProjectCtx,
    @Body(pipe(automationScheduleSchema)) body: AutomationScheduleInput,
  ) {
    return this.runs.createSchedule(ctx, body);
  }

  @Patch('automation-schedules/:id')
  @RequirePermission('automation:configure')
  @schemaBody(updateAutomationScheduleSchema)
  updateSchedule(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(pipe(updateAutomationScheduleSchema)) body: Partial<AutomationScheduleInput>,
  ) {
    return this.runs.updateSchedule(ctx, id, body);
  }

  @Delete('automation-schedules/:id')
  @HttpCode(204)
  @RequirePermission('automation:configure')
  async deleteSchedule(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.runs.deleteSchedule(ctx, id);
  }

  @Get('ci-tokens')
  @RequirePermission('automation:configure')
  tokens(@Ctx() ctx: ProjectCtx) {
    return this.runs.tokens(ctx.projectId);
  }

  /** Returns the token once; only its hash is stored. */
  @Post('ci-tokens')
  @RequirePermission('automation:configure')
  @schemaBody(createProjectTokenSchema)
  createToken(
    @Ctx() ctx: ProjectCtx,
    @Body(pipe(createProjectTokenSchema)) body: { name: string; expiresInDays: number | null },
  ) {
    return this.runs.createToken(ctx, body);
  }

  @Delete('ci-tokens/:id')
  @HttpCode(204)
  @RequirePermission('automation:configure')
  async revokeToken(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.runs.revokeToken(ctx, id);
  }
}

/** CI webhook: authenticated by a project token instead of a session. */
@ApiTags('automation')
@Controller('v1/hooks/automation')
export class CiHooksController {
  constructor(private readonly runs: AutomationRunsService) {}

  @Post()
  @Public()
  @HttpCode(202)
  @schemaBody(ciTriggerSchema)
  trigger(
    @Headers('authorization') auth: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body(pipe(ciTriggerSchema)) body: CiTriggerInput,
  ) {
    return this.runs.ciTrigger(auth, key, body);
  }

  /** Poll until `done` is true; `status` PASSED means the pipeline may continue. */
  @Get('runs/:ref')
  @Public()
  status(@Headers('authorization') auth: string | undefined, @Param('ref') ref: string) {
    return this.runs.ciStatus(auth, ref);
  }
}

@Module({
  controllers: [
    ApiTestingController,
    AutomationTestsController,
    AutomationRunsController,
    CiHooksController,
  ],
  providers: [ApiCollectionsService, AutomationTestsService, AutomationRunsService],
  exports: [ApiCollectionsService, AutomationTestsService, AutomationRunsService],
})
export class AutomationModule {}
