import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  createOrganizationSchema,
  inviteMemberSchema,
  updateMemberSchema,
  updateOrganizationSchema,
} from '@qaforge/shared';
import { CurrentPrincipal, RequirePermission } from '../auth/decorators';
import type { AuthedRequest, Principal } from '../auth/principal';
import { actorOf } from '../audit/audit.service';
import { OrganizationsService } from './organizations.service';

class CreateOrganizationDto extends createZodDto(createOrganizationSchema) {}
class UpdateOrganizationDto extends createZodDto(updateOrganizationSchema) {}
class InviteMemberDto extends createZodDto(inviteMemberSchema) {}
class UpdateMemberDto extends createZodDto(updateMemberSchema) {}

@ApiTags('organizations')
@Controller('v1/orgs')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get()
  list(@CurrentPrincipal() p: Principal) {
    return this.orgs.listForUser(p.userId);
  }

  @Post()
  create(@CurrentPrincipal() p: Principal, @Body() body: CreateOrganizationDto) {
    return this.orgs.create({ type: 'USER', id: p.userId }, body);
  }

  @Get(':orgId')
  @RequirePermission('org:read')
  async get(@Param('orgId', ParseUUIDPipe) orgId: string, @Req() req: AuthedRequest) {
    return { ...(await this.orgs.get(orgId)), role: req.membership!.role };
  }

  @Patch(':orgId')
  @RequirePermission('org:update')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: UpdateOrganizationDto,
  ) {
    return this.orgs.update(actorOf(p), orgId, body);
  }

  @Get(':orgId/members')
  @RequirePermission('members:read')
  members(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.orgs.listMembers(orgId);
  }

  @Patch(':orgId/members/:memberId')
  @RequirePermission('members:manage')
  updateMember(
    @CurrentPrincipal() p: Principal,
    @Req() req: AuthedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() body: UpdateMemberDto,
  ) {
    return this.orgs.updateMemberRole(actorOf(p), req.membership!.role, orgId, memberId, body.role);
  }

  @Delete(':orgId/members/:memberId')
  @HttpCode(204)
  @RequirePermission('org:read') // self-removal allowed; service enforces members:manage for others
  async removeMember(
    @CurrentPrincipal() p: Principal,
    @Req() req: AuthedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    await this.orgs.removeMember(actorOf(p), req.membership!.role, orgId, memberId);
  }

  @Get(':orgId/invitations')
  @RequirePermission('members:manage')
  invitations(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.orgs.listInvitations(orgId);
  }

  @Post(':orgId/invitations')
  @RequirePermission('members:manage')
  invite(
    @CurrentPrincipal() p: Principal,
    @Req() req: AuthedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: InviteMemberDto,
  ) {
    return this.orgs.invite({ type: 'USER', id: p.userId }, req.membership!.role, orgId, body);
  }

  @Delete(':orgId/invitations/:invitationId')
  @HttpCode(204)
  @RequirePermission('members:manage')
  async revoke(
    @CurrentPrincipal() p: Principal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    await this.orgs.revokeInvitation(actorOf(p), orgId, invitationId);
  }
}

@ApiTags('organizations')
@Controller('v1/invitations')
export class InvitationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post(':invitationId/accept')
  accept(@CurrentPrincipal() p: Principal, @Param('invitationId', ParseUUIDPipe) id: string) {
    return this.orgs.acceptInvitation({ type: 'USER', id: p.userId }, p.email, id);
  }
}
