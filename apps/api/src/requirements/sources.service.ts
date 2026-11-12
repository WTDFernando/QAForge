import { Injectable, NotFoundException } from '@nestjs/common';
import { REQUIREMENT_UPLOAD_TYPES } from '@qaforge/shared';
import { AuditService } from '../audit/audit.service';
import type { ProjectCtx } from '../common/project-scope';
import { PrismaService } from '../prisma/prisma.module';
import { AttachmentsService, type UploadedFileLike } from '../storage/attachments.service';

/**
 * Requirement sources: uploaded documents and links (e.g. Figma). In Phase 3 the
 * Requirement Agent picks up UPLOADED sources and splits them into requirements.
 */
@Injectable()
export class SourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attachments: AttachmentsService,
  ) {}

  list(projectId: string) {
    return this.prisma.client.requirementSource.findMany({
      where: { projectId },
      include: {
        attachment: { select: { id: true, fileName: true, contentType: true, size: true } },
        _count: { select: { requirements: { where: { deletedAt: null } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upload(ctx: ProjectCtx, file: UploadedFileLike) {
    return this.prisma.client.$transaction(async (tx) => {
      const attachment = await this.attachments.store(tx, ctx, file, REQUIREMENT_UPLOAD_TYPES);
      const source = await tx.requirementSource.create({
        data: {
          projectId: ctx.projectId,
          kind: 'FILE',
          name: attachment.fileName,
          attachmentId: attachment.id,
          createdById: ctx.actor.id,
        },
      });
      await tx.attachment.update({
        where: { id: attachment.id },
        data: { entityType: 'requirement_source', entityId: source.id },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'requirement_source',
        entityId: source.id,
        action: 'create',
        after: { name: source.name, kind: 'FILE', size: attachment.size },
      });
      return { ...source, attachment };
    });
  }

  async addLink(ctx: ProjectCtx, input: { name: string; url: string }) {
    return this.prisma.client.$transaction(async (tx) => {
      const source = await tx.requirementSource.create({
        data: {
          projectId: ctx.projectId,
          kind: 'LINK',
          name: input.name,
          url: input.url,
          createdById: ctx.actor.id,
        },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'requirement_source',
        entityId: source.id,
        action: 'create',
        after: { name: source.name, kind: 'LINK', url: input.url },
      });
      return source;
    });
  }

  async remove(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const source = await tx.requirementSource.findFirst({
        where: { id, projectId: ctx.projectId },
      });
      if (!source) throw new NotFoundException('Source not found');
      // Requirements created from it keep existing (sourceId is set to null).
      await tx.requirementSource.delete({ where: { id } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'requirement_source',
        entityId: id,
        action: 'delete',
        metadata: { name: source.name },
      });
    });
  }
}
