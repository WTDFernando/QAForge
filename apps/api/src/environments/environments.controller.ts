import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { environmentSchema, updateEnvironmentSchema, type EnvironmentInput } from '@qaforge/shared';
import type { Environment } from '@qaforge/db';
import { RequirePermission } from '../auth/decorators';
import { AuditService } from '../audit/audit.service';
import { decryptJson, encryptJson } from '../common/crypto';
import { rethrowUnique } from '../common/errors';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { PrismaService } from '../prisma/prisma.module';

class EnvironmentDto extends createZodDto(environmentSchema) {}
class UpdateEnvironmentDto extends createZodDto(updateEnvironmentSchema) {}

type Secrets = Record<string, string>;

/** Public shape: secrets are never returned, only their names. */
function present(e: Environment) {
  const { secrets, ...rest } = e;
  return { ...rest, secretKeys: secrets ? Object.keys(decryptJson<Secrets>(secrets)).sort() : [] };
}

function mergeSecrets(
  existing: string | null,
  patch: Record<string, string | null> | undefined,
): string | null | undefined {
  if (!patch) return undefined;
  const current = existing ? decryptJson<Secrets>(existing) : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete current[k];
    else current[k] = v;
  }
  return Object.keys(current).length ? encryptJson(current) : null;
}

@Injectable()
export class EnvironmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(projectId: string) {
    const rows = await this.prisma.client.environment.findMany({
      where: { projectId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(present);
  }

  /** Decrypted secrets for internal use by the runner (never exposed over HTTP). */
  async resolveSecrets(projectId: string, id: string): Promise<Secrets> {
    const e = await this.prisma.client.environment.findFirst({ where: { id, projectId } });
    return e?.secrets ? decryptJson<Secrets>(e.secrets) : {};
  }

  async create(ctx: ProjectCtx, input: EnvironmentInput) {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const count = await tx.environment.count({ where: { projectId: ctx.projectId } });
        const env = await tx.environment.create({
          data: {
            projectId: ctx.projectId,
            name: input.name,
            baseUrl: input.baseUrl ?? null,
            variables: input.variables,
            secrets: mergeSecrets(null, input.secrets) ?? null,
            position: count,
            createdById: ctx.actor.id,
          },
        });
        await this.audit.record(tx, ctx.actor, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          entityType: 'environment',
          entityId: env.id,
          action: 'create',
          after: { name: env.name, baseUrl: env.baseUrl },
          metadata: input.secrets ? { secretKeys: Object.keys(input.secrets) } : undefined,
        });
        return present(env);
      });
    } catch (e) {
      rethrowUnique(e, `An environment named "${input.name}" already exists`);
    }
  }

  async update(ctx: ProjectCtx, id: string, input: Partial<EnvironmentInput>) {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const before = await tx.environment.findFirst({ where: { id, projectId: ctx.projectId } });
        if (!before) throw new NotFoundException('Environment not found');
        const secrets = mergeSecrets(before.secrets, input.secrets);
        const data = {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl ?? null }),
          ...(input.variables !== undefined && { variables: input.variables }),
          ...(secrets !== undefined && { secrets }),
        };
        const env = await tx.environment.update({ where: { id }, data });
        await this.audit.record(tx, ctx.actor, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          entityType: 'environment',
          entityId: id,
          action: 'update',
          before: { name: before.name, baseUrl: before.baseUrl, variables: before.variables },
          // Secret values never reach the audit log; only which keys changed.
          after: {
            name: data.name,
            baseUrl: data.baseUrl,
            variables: data.variables,
            ...(input.secrets && { secretKeysChanged: Object.keys(input.secrets) }),
          },
        });
        return present(env);
      });
    } catch (e) {
      rethrowUnique(e, `An environment named "${input.name}" already exists`);
    }
  }

  async remove(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const env = await tx.environment.findFirst({ where: { id, projectId: ctx.projectId } });
      if (!env) throw new NotFoundException('Environment not found');
      await tx.environment.delete({ where: { id } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'environment',
        entityId: id,
        action: 'delete',
        metadata: { name: env.name },
      });
    });
  }
}

@ApiTags('environments')
@Controller('v1/projects/:projectId/environments')
export class EnvironmentsController {
  constructor(private readonly envs: EnvironmentsService) {}

  @Get()
  @RequirePermission('project:read')
  list(@Ctx() ctx: ProjectCtx) {
    return this.envs.list(ctx.projectId);
  }

  @Post()
  @RequirePermission('project:update')
  create(@Ctx() ctx: ProjectCtx, @Body() body: EnvironmentDto) {
    return this.envs.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission('project:update')
  update(
    @Ctx() ctx: ProjectCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateEnvironmentDto,
  ) {
    return this.envs.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('project:update')
  async remove(@Ctx() ctx: ProjectCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.envs.remove(ctx, id);
  }
}

@Module({
  controllers: [EnvironmentsController],
  providers: [EnvironmentsService],
  exports: [EnvironmentsService],
})
export class EnvironmentsModule {}
