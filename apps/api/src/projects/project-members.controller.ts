import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { canAssignRole, updateMemberSchema } from '@qaforge/shared';
import { RequirePermission } from '../auth/decorators';
import { AuditService } from '../audit/audit.service';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { PrismaService } from '../prisma/prisma.module';

class RoleDto extends createZodDto(updateMemberSchema) {}

/** Project-level role overrides: a member's role in this project instead of their org role. */
@ApiTags('projects')
@Controller('v1/projects/:projectId/members')
export class ProjectMembersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('members:read')
  async list(@Ctx() ctx: ProjectCtx) {
    const [members, overrides] = await Promise.all([
      this.prisma.client.membership.findMany({
        where: { organizationId: ctx.organizationId },
        select: {
          role: true,
          user: { select: { id: true, name: true, email: true, image: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.client.projectMember.findMany({ where: { projectId: ctx.projectId } }),
    ]);
    const byUser = new Map(overrides.map((o) => [o.userId, o.role]));
    return members.map((m) => ({
      user: m.user,
      orgRole: m.role,
      projectRole: byUser.get(m.user.id) ?? null,
      effectiveRole: byUser.get(m.user.id) ?? m.role,
    }));
  }

  @Put(':userId')
  @RequirePermission('members:manage')
  async set(
    @Ctx() ctx: ProjectCtx,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: RoleDto,
  ) {
    const m = await this.prisma.client.membership.findUnique({
      where: { organizationId_userId: { organizationId: ctx.organizationId, userId } },
    });
    if (!m) throw new ForbiddenException('Not a member of this organization');
    if (m.role === 'OWNER') throw new ForbiddenException('Owners keep their role in every project');
    if (!canAssignRole(ctx.role, body.role) || !canAssignRole(ctx.role, m.role))
      throw new ForbiddenException('You cannot assign this role');
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId: ctx.projectId, userId } },
      });
      const pm = await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: ctx.projectId, userId } },
        update: { role: body.role },
        create: { projectId: ctx.projectId, userId, role: body.role },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'project_member',
        entityId: userId,
        action: before ? 'update' : 'create',
        before: before ? { role: before.role } : null,
        after: { role: body.role },
      });
      return pm;
    });
  }

  @Delete(':userId')
  @HttpCode(204)
  @RequirePermission('members:manage')
  async clear(@Ctx() ctx: ProjectCtx, @Param('userId', ParseUUIDPipe) userId: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const res = await tx.projectMember.deleteMany({
        where: { projectId: ctx.projectId, userId },
      });
      if (res.count)
        await this.audit.record(tx, ctx.actor, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          entityType: 'project_member',
          entityId: userId,
          action: 'delete',
        });
    });
  }
}
