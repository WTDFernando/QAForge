import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { createProjectSchema, updateProjectSchema } from '@qaforge/shared';
import { CurrentPrincipal, RequirePermission } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { actorOf } from '../audit/audit.service';
import { ProjectsService } from './projects.service';

class CreateProjectDto extends createZodDto(createProjectSchema) {}
class UpdateProjectDto extends createZodDto(updateProjectSchema) {}
class ListProjectsQuery extends createZodDto(
  z.object({ includeArchived: z.stringbool().optional() }),
) {}

@ApiTags('projects')
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('v1/orgs/:orgId/projects')
  @RequirePermission('project:read')
  list(@Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: ListProjectsQuery) {
    return this.projects.list(orgId, q.includeArchived ?? false);
  }

  @Post('v1/orgs/:orgId/projects')
  @RequirePermission('project:create')
  create(
    @CurrentPrincipal() p: Principal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: CreateProjectDto,
  ) {
    return this.projects.create({ type: 'USER', id: p.userId }, orgId, body);
  }

  @Get('v1/projects/:projectId')
  @RequirePermission('project:read')
  get(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.projects.get(projectId);
  }

  @Patch('v1/projects/:projectId')
  @RequirePermission('project:update')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: UpdateProjectDto,
  ) {
    return this.projects.update(actorOf(p), projectId, body);
  }
}
