import { Injectable, NotFoundException } from '@nestjs/common';
import type { CreateProjectInput, UpdateProjectInput } from '@qaforge/shared';
import { PrismaService } from '../prisma/prisma.module';
import { AuditService, type Actor } from '../audit/audit.service';
import { rethrowUnique } from '../common/errors';

const projectSelect = {
  id: true,
  organizationId: true,
  name: true,
  key: true,
  description: true,
  archivedAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(orgId: string, includeArchived = false) {
    return this.prisma.client.project.findMany({
      where: { organizationId: orgId, ...(includeArchived ? {} : { archivedAt: null }) },
      select: projectSelect,
      orderBy: { name: 'asc' },
    });
  }

  async create(actor: Actor & { id: string }, orgId: string, input: CreateProjectInput) {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const project = await tx.project.create({
          data: { ...input, organizationId: orgId, createdById: actor.id },
          select: projectSelect,
        });
        await this.audit.record(tx, actor, {
          organizationId: orgId,
          projectId: project.id,
          entityType: 'project',
          entityId: project.id,
          action: 'create',
          after: input,
        });
        return project;
      });
    } catch (e) {
      rethrowUnique(e, `Project key "${input.key}" is already used in this organization`);
    }
  }

  async get(projectId: string) {
    const project = await this.prisma.client.project.findUnique({
      where: { id: projectId },
      select: projectSelect,
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async update(actor: Actor, projectId: string, input: UpdateProjectInput) {
    const { archived, ...fields } = input;
    const data = {
      ...fields,
      ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }),
    };
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const before = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
        const project = await tx.project.update({
          where: { id: projectId },
          data,
          select: projectSelect,
        });
        const action = archived === undefined ? 'update' : archived ? 'archive' : 'restore';
        await this.audit.record(tx, actor, {
          organizationId: project.organizationId,
          projectId,
          entityType: 'project',
          entityId: projectId,
          action,
          before,
          after: data,
        });
        return project;
      });
    } catch (e) {
      rethrowUnique(e, `Project key "${input.key}" is already used in this organization`);
    }
  }
}
