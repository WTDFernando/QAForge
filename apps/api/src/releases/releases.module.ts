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
  Put,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import {
  approvalDecisionSchema,
  approversSchema,
  releaseSchema,
  releaseScopeSchema,
  setGatesSchema,
  updateReleaseSchema,
  type ApprovalDecisionInput,
  type GateInput,
  type ReleaseInput,
  type ReleaseScopeInput,
} from '@qaforge/shared';
import { RequirePermission } from '../auth/decorators';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { ReleasesService } from './releases.service';

const schemaBody = (s: z.ZodType) =>
  ApiBody({ schema: z.toJSONSchema(s, { unrepresentable: 'any' }) as object });
const pipe = (s: z.ZodType) => new ZodValidationPipe(s);

@ApiTags('releases')
@Controller('v1/projects/:projectId/releases')
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get()
  @RequirePermission('release:read')
  list(@Ctx() ctx: ProjectCtx) {
    return this.releases.list(ctx.projectId);
  }

  /** By id or ref (REL-0001): scope, runs, bugs, live gates, readiness and approvals. */
  @Get(':idOrRef')
  @RequirePermission('release:read')
  get(@Ctx() ctx: ProjectCtx, @Param('idOrRef') idOrRef: string) {
    return this.releases.get(ctx.projectId, idOrRef);
  }

  @Post()
  @RequirePermission('release:write')
  @schemaBody(releaseSchema)
  create(@Ctx() ctx: ProjectCtx, @Body(pipe(releaseSchema)) body: ReleaseInput) {
    return this.releases.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission('release:write')
  @schemaBody(updateReleaseSchema)
  update(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(pipe(updateReleaseSchema)) body: Partial<ReleaseInput>,
  ) {
    return this.releases.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('release:write')
  async remove(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.releases.remove(ctx, id);
  }

  @Post(':id/scope')
  @RequirePermission('release:write')
  @schemaBody(releaseScopeSchema)
  scope(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(pipe(releaseScopeSchema)) body: ReleaseScopeInput,
  ) {
    return this.releases.scope(ctx, id, body);
  }

  @Put(':id/gates')
  @RequirePermission('release:write')
  @schemaBody(setGatesSchema)
  gates(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(pipe(setGatesSchema)) body: { gates: GateInput[] },
  ) {
    return this.releases.setGates(ctx, id, body.gates);
  }

  @Put(':id/approvers')
  @RequirePermission('release:sign')
  @schemaBody(approversSchema)
  approvers(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(pipe(approversSchema)) body: { approvers: { userId: string; roleLabel: string }[] },
  ) {
    return this.releases.setApprovers(ctx, id, body.approvers);
  }

  @Post(':id/request-approval')
  @HttpCode(200)
  @RequirePermission('release:sign')
  requestApproval(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.releases.requestApproval(ctx, id);
  }

  /** The signed-in user's own decision; they must be a named approver. */
  @Post(':id/decision')
  @HttpCode(200)
  @RequirePermission('release:approve')
  @schemaBody(approvalDecisionSchema)
  decide(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(pipe(approvalDecisionSchema)) body: ApprovalDecisionInput,
  ) {
    return this.releases.decide(ctx, id, body);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermission('release:sign')
  reopen(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.releases.reopen(ctx, id);
  }

  @Post(':id/release')
  @HttpCode(200)
  @RequirePermission('release:sign')
  markReleased(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.releases.markReleased(ctx, id);
  }
}

@Module({
  controllers: [ReleasesController],
  providers: [ReleasesService],
  exports: [ReleasesService],
})
export class ReleasesModule {}
