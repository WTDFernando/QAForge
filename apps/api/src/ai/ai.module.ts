import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  Sse,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import {
  aiSettingsSchema,
  copilotRequestSchema,
  startAgentJobSchema,
  type CopilotRequest,
  type StartAgentJobInput,
} from '@qaforge/shared';
import { CurrentPrincipal, RequirePermission } from '../auth/decorators';
import type { AuthedRequest, Principal } from '../auth/principal';
import { actorOf } from '../audit/audit.service';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { AgentJobsService } from './agent-jobs.service';
import { AiSettingsService } from './ai-settings.service';
import { CopilotService } from './copilot.service';

class AiSettingsDto extends createZodDto(aiSettingsSchema) {}
class JobsQuery extends createZodDto(
  z.object({
    sourceId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
) {}

@ApiTags('ai')
@Controller('v1/orgs/:orgId')
export class AiOrgController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly jobs: AgentJobsService,
  ) {}

  @Get('ai-settings')
  @RequirePermission('org:read')
  async get(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.settings.view(await this.settings.stored(orgId));
  }

  @Put('ai-settings')
  @RequirePermission('ai:configure')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: AiSettingsDto,
  ) {
    return this.settings.update(actorOf(p), orgId, body);
  }

  @Get('ai-usage')
  @RequirePermission('ai:configure')
  usage(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.settings.usage(orgId);
  }

  /** Active jobs in the org + the caller's jobs from the last 24h (agent activity indicator). */
  @Get('agent-jobs')
  @RequirePermission('org:read')
  recent(@CurrentPrincipal() p: Principal, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.jobs.listForOrg(orgId, p.userId);
  }

  /** Server-Sent Events: every change to an agent job in this organization. */
  @Sse('agent-jobs/stream')
  @RequirePermission('org:read')
  stream(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.jobs.stream(orgId);
  }
}

@ApiTags('ai')
@Controller('v1/projects/:projectId')
export class AiProjectController {
  constructor(
    private readonly jobs: AgentJobsService,
    private readonly copilot: CopilotService,
  ) {}

  @Post('agent-jobs')
  @RequirePermission('ai:use')
  @ApiBody({ schema: z.toJSONSchema(startAgentJobSchema, { unrepresentable: 'any' }) as object })
  start(
    @Ctx() ctx: ProjectCtx,
    @Body(new ZodValidationPipe(startAgentJobSchema)) body: StartAgentJobInput,
  ) {
    return this.jobs.start(ctx, body);
  }

  @Get('agent-jobs')
  @RequirePermission('project:read')
  list(@Ctx() ctx: ProjectCtx, @Query() q: JobsQuery) {
    return this.jobs.list(ctx.projectId, q);
  }

  @Get('agent-jobs/:id')
  @RequirePermission('project:read')
  get(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.get(ctx.projectId, id);
  }

  @Post('agent-jobs/:id/cancel')
  @RequirePermission('ai:use')
  cancel(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.cancel(ctx, id);
  }

  /** QA Copilot chat, streamed as Server-Sent Events. */
  @Post('copilot')
  @RequirePermission('ai:use')
  @ApiBody({ schema: z.toJSONSchema(copilotRequestSchema, { unrepresentable: 'any' }) as object })
  async chat(
    @Ctx() ctx: ProjectCtx,
    @Body(new ZodValidationPipe(copilotRequestSchema)) body: CopilotRequest,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ) {
    const events = this.copilot.chat(ctx, body);
    // Validate (settings/budget) before switching to a streaming response so errors are normal JSON.
    const first = await events.next();
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    let closed = false;
    req.on('close', () => (closed = true));
    const send = (e: unknown) => !closed && res.write(`data: ${JSON.stringify(e)}\n\n`);
    try {
      if (!first.done) send(first.value);
      for await (const e of events) {
        if (closed) break;
        send(e);
      }
    } catch (e) {
      send({
        type: 'error',
        message:
          e instanceof Error && 'status' in e && (e as { status: number }).status < 500
            ? (e as Error).message
            : 'The AI service failed. Please try again.',
      });
    }
    res.end();
  }
}

@Module({
  controllers: [AiOrgController, AiProjectController],
  providers: [AiSettingsService, AgentJobsService, CopilotService],
  exports: [AgentJobsService, AiSettingsService],
})
export class AiModule {}
