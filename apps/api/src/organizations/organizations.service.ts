import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Role } from '@qaforge/db';
import {
  canAssignRole,
  type CreateOrganizationInput,
  type InviteMemberInput,
  type UpdateOrganizationInput,
} from '@qaforge/shared';
import { PrismaService } from '../prisma/prisma.module';
import { AuditService, type Actor } from '../audit/audit.service';
import { rethrowUnique } from '../common/errors';

const INVITE_TTL_DAYS = 7;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listForUser(userId: string) {
    return this.prisma.client.membership
      .findMany({
        where: { userId },
        include: {
          organization: { include: { _count: { select: { projects: true, memberships: true } } } },
        },
        orderBy: { organization: { name: 'asc' } },
      })
      .then((rows) =>
        rows.map((m) => ({
          id: m.organization.id,
          name: m.organization.name,
          slug: m.organization.slug,
          role: m.role,
          projectCount: m.organization._count.projects,
          memberCount: m.organization._count.memberships,
        })),
      );
  }

  async create(actor: Actor & { id: string }, input: CreateOrganizationInput) {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const org = await tx.organization.create({ data: input });
        await tx.membership.create({
          data: { organizationId: org.id, userId: actor.id, role: 'OWNER' },
        });
        await this.audit.record(tx, actor, {
          organizationId: org.id,
          entityType: 'organization',
          entityId: org.id,
          action: 'create',
          after: input,
        });
        return { ...org, role: 'OWNER' as Role };
      });
    } catch (e) {
      rethrowUnique(e, `The URL "${input.slug}" is already taken`);
    }
  }

  async get(orgId: string) {
    const org = await this.prisma.client.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true, createdAt: true, updatedAt: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async update(actor: Actor, orgId: string, input: UpdateOrganizationInput) {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const before = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
        const org = await tx.organization.update({ where: { id: orgId }, data: input });
        await this.audit.record(tx, actor, {
          organizationId: orgId,
          entityType: 'organization',
          entityId: orgId,
          action: 'update',
          before,
          after: input,
        });
        return { id: org.id, name: org.name, slug: org.slug };
      });
    } catch (e) {
      rethrowUnique(e, `The URL "${input.slug}" is already taken`);
    }
  }

  // ---- members -----------------------------------------------------------

  listMembers(orgId: string) {
    return this.prisma.client.membership.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, image: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateMemberRole(
    actor: Actor,
    actorRole: Role,
    orgId: string,
    memberId: string,
    role: Role,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const member = await tx.membership.findFirst({
        where: { id: memberId, organizationId: orgId },
      });
      if (!member) throw new NotFoundException('Member not found');
      if (!canAssignRole(actorRole, role) || !canAssignRole(actorRole, member.role)) {
        throw new ForbiddenException('You cannot assign or change this role');
      }
      if (member.role === 'OWNER' && role !== 'OWNER')
        await this.assertAnotherOwner(tx, orgId, member.id);
      const updated = await tx.membership.update({ where: { id: memberId }, data: { role } });
      await this.audit.record(tx, actor, {
        organizationId: orgId,
        entityType: 'membership',
        entityId: memberId,
        action: 'update',
        before: member,
        after: { role },
      });
      return updated;
    });
  }

  async removeMember(actor: Actor, actorRole: Role, orgId: string, memberId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const member = await tx.membership.findFirst({
        where: { id: memberId, organizationId: orgId },
      });
      if (!member) throw new NotFoundException('Member not found');
      const isSelf = member.userId === actor.id;
      if (!isSelf && !canAssignRole(actorRole, member.role)) {
        throw new ForbiddenException('You cannot remove this member');
      }
      if (member.role === 'OWNER') await this.assertAnotherOwner(tx, orgId, member.id);
      await tx.membership.delete({ where: { id: memberId } });
      await this.audit.record(tx, actor, {
        organizationId: orgId,
        entityType: 'membership',
        entityId: memberId,
        action: 'delete',
        metadata: { userId: member.userId, role: member.role },
      });
    });
  }

  private async assertAnotherOwner(
    tx: Prisma.TransactionClient,
    orgId: string,
    excludingMemberId: string,
  ) {
    const owners = await tx.membership.count({
      where: { organizationId: orgId, role: 'OWNER', id: { not: excludingMemberId } },
    });
    if (owners === 0) throw new BadRequestException('An organization must keep at least one Owner');
  }

  // ---- invitations ------------------------------------------------------

  listInvitations(orgId: string) {
    return this.prisma.client.invitation.findMany({
      where: { organizationId: orgId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async invite(
    actor: Actor & { id: string },
    actorRole: Role,
    orgId: string,
    input: InviteMemberInput,
  ) {
    if (!canAssignRole(actorRole, input.role)) {
      throw new ForbiddenException('You cannot invite someone with this role');
    }
    const email = input.email.toLowerCase();
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.membership.findFirst({
        where: { organizationId: orgId, user: { email } },
      });
      if (existing) throw new BadRequestException('This person is already a member');
      await tx.invitation.updateMany({
        where: { organizationId: orgId, email, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      const invitation = await tx.invitation.create({
        data: {
          organizationId: orgId,
          email,
          role: input.role,
          invitedById: actor.id,
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
        },
      });
      await this.audit.record(tx, actor, {
        organizationId: orgId,
        entityType: 'invitation',
        entityId: invitation.id,
        action: 'create',
        after: { email, role: input.role },
      });
      // Email delivery is wired in a later phase (notifications); the accept link is /invite/:id.
      return invitation;
    });
  }

  async revokeInvitation(actor: Actor, orgId: string, invitationId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const inv = await tx.invitation.findFirst({
        where: { id: invitationId, organizationId: orgId },
      });
      if (!inv) throw new NotFoundException('Invitation not found');
      await tx.invitation.update({ where: { id: inv.id }, data: { status: 'REVOKED' } });
      await this.audit.record(tx, actor, {
        organizationId: orgId,
        entityType: 'invitation',
        entityId: inv.id,
        action: 'delete',
      });
    });
  }

  /** Accept an invitation addressed to the signed-in user's email. */
  async acceptInvitation(actor: Actor & { id: string }, email: string, invitationId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const inv = await tx.invitation.findUnique({ where: { id: invitationId } });
      if (!inv || inv.email !== email.toLowerCase())
        throw new NotFoundException('Invitation not found');
      if (inv.status !== 'PENDING')
        throw new BadRequestException('This invitation is no longer valid');
      if (inv.expiresAt < new Date()) {
        await tx.invitation.update({ where: { id: inv.id }, data: { status: 'EXPIRED' } });
        throw new BadRequestException('This invitation has expired');
      }
      const membership = await tx.membership.upsert({
        where: { organizationId_userId: { organizationId: inv.organizationId, userId: actor.id } },
        update: {},
        create: { organizationId: inv.organizationId, userId: actor.id, role: inv.role },
      });
      await tx.invitation.update({ where: { id: inv.id }, data: { status: 'ACCEPTED' } });
      await this.audit.record(tx, actor, {
        organizationId: inv.organizationId,
        entityType: 'membership',
        entityId: membership.id,
        action: 'create',
        metadata: { invitationId: inv.id, role: inv.role },
      });
      return { organizationId: inv.organizationId, role: membership.role };
    });
  }
}
