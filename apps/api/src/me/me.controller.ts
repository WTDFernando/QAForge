import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { PrismaService } from '../prisma/prisma.module';

@ApiTags('me')
@Controller('v1/me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async me(@CurrentPrincipal() p: Principal) {
    const [user, memberships, invitations] = await Promise.all([
      this.prisma.client.user.findUniqueOrThrow({
        where: { id: p.userId },
        select: { id: true, name: true, email: true, image: true },
      }),
      this.prisma.client.membership.findMany({
        where: { userId: p.userId },
        select: { role: true, organization: { select: { id: true, name: true, slug: true } } },
      }),
      this.prisma.client.invitation.findMany({
        where: { email: p.email.toLowerCase(), status: 'PENDING', expiresAt: { gt: new Date() } },
        select: { id: true, role: true, organization: { select: { name: true } } },
      }),
    ]);
    return {
      user,
      organizations: memberships.map((m) => ({ ...m.organization, role: m.role })),
      pendingInvitations: invitations,
    };
  }
}

@Module({ controllers: [MeController] })
export class MeModule {}
