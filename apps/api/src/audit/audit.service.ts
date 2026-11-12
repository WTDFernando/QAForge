import { Injectable } from '@nestjs/common';
import { diffChanges, Prisma, type ActorType } from '@qaforge/db';
import { PrismaService } from '../prisma/prisma.module';
import type { Principal } from '../auth/principal';

type Tx = Prisma.TransactionClient;

export interface AuditEntry {
  organizationId: string;
  projectId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export interface Actor {
  type: ActorType;
  id: string | null;
}

export function actorOf(principal: Principal | undefined): Actor {
  return principal ? { type: principal.type, id: principal.userId } : { type: 'SYSTEM', id: null };
}

/** Append-only audit trail. Always call inside the same transaction as the mutation. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tx: Tx, actor: Actor, entry: AuditEntry): Promise<void> {
    const changes = entry.after ? diffChanges(entry.before ?? null, entry.after) : undefined;
    // Don't clutter history with no-op updates.
    if (entry.action === 'update' && changes && Object.keys(changes).length === 0) return;
    await tx.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        projectId: entry.projectId ?? null,
        actorType: actor.type,
        actorId: actor.id,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        changes:
          changes && Object.keys(changes).length ? (changes as Prisma.InputJsonValue) : undefined,
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async list(params: {
    organizationId: string;
    projectId?: string;
    entityType?: string;
    entityId?: string;
    cursor?: string;
    limit: number;
  }) {
    const items = await this.prisma.client.auditLog.findMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        entityType: params.entityType,
        entityId: params.entityId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > params.limit;
    const page = hasMore ? items.slice(0, params.limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }
}
