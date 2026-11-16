import {
  Controller,
  Get,
  Global,
  HttpCode,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { notificationQuerySchema } from '@qaforge/shared';
import type { Prisma } from '@qaforge/db';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { PrismaService } from '../prisma/prisma.module';

class NotificationQuery extends createZodDto(notificationQuerySchema) {}

export interface NotifyInput {
  organizationId: string;
  projectId?: string | null;
  userIds: string[];
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  url?: string;
  actorId?: string | null;
}

/** In-app notifications. Never notifies the actor about their own action. */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(input: NotifyInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma.client;
    const userIds = [...new Set(input.userIds)].filter((u) => u && u !== input.actorId);
    if (!userIds.length) return 0;
    // Only current members of the organization receive notifications.
    const members = await db.membership.findMany({
      where: { organizationId: input.organizationId, userId: { in: userIds } },
      select: { userId: true },
    });
    const res = await db.notification.createMany({
      data: members.map((m) => ({
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        userId: m.userId,
        type: input.type,
        title: input.title.slice(0, 300),
        body: (input.body ?? '').slice(0, 1000),
        entityType: input.entityType,
        entityId: input.entityId,
        url: input.url,
        actorId: input.actorId ?? null,
      })),
    });
    return res.count;
  }

  async list(userId: string, q: { unreadOnly?: boolean; limit: number }) {
    const [items, unread] = await Promise.all([
      this.prisma.client.notification.findMany({
        where: { userId, ...(q.unreadOnly ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
      }),
      this.prisma.client.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unread };
  }

  async markRead(userId: string, id?: string) {
    const res = await this.prisma.client.notification.updateMany({
      where: { userId, readAt: null, ...(id ? { id } : {}) },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }
}

@ApiTags('notifications')
@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentPrincipal() p: Principal, @Query() q: NotificationQuery) {
    return this.svc.list(p.userId, q);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentPrincipal() p: Principal) {
    return this.svc.markRead(p.userId);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markRead(p.userId, id);
  }
}

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
