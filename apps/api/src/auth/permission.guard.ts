import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, type Permission } from '@qaforge/shared';
import { PrismaService } from '../prisma/prisma.module';
import { REQUIRED_PERMISSION } from './decorators';
import type { AuthedRequest } from './principal';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tenant isolation + RBAC. Resolves the caller's membership for the org that owns
 * the route's resource. Non-members get 404 (not 403) so we never leak existence.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!permission) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.principal) return false;
    const params = req.params as Record<string, string | undefined>;

    let organizationId = params.orgId;
    let projectId: string | undefined;
    if (!organizationId && params.projectId) {
      if (!UUID.test(params.projectId)) throw new NotFoundException('Project not found');
      const project = await this.prisma.client.project.findUnique({
        where: { id: params.projectId },
        select: { organizationId: true },
      });
      if (!project) throw new NotFoundException('Project not found');
      organizationId = project.organizationId;
      projectId = params.projectId;
    }
    if (!organizationId || !UUID.test(organizationId)) {
      throw new NotFoundException('Organization not found');
    }

    const membership = await this.prisma.client.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId: req.principal.userId } },
      select: { role: true },
    });
    if (!membership) {
      throw new NotFoundException(projectId ? 'Project not found' : 'Organization not found');
    }
    // A project-level override replaces the org role inside that project (Owners are never overridden).
    let role = membership.role;
    if (projectId && role !== 'OWNER') {
      const override = await this.prisma.client.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: req.principal.userId } },
        select: { role: true },
      });
      if (override) role = override.role;
    }
    if (!hasPermission(role, permission)) {
      throw new ForbiddenException(`Your role (${role}) lacks "${permission}"`);
    }
    req.membership = { organizationId, role, projectId };
    return true;
  }
}
