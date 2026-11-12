import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginationSchema } from '@qaforge/shared';
import { RequirePermission } from '../auth/decorators';
import { AuditService } from './audit.service';

class AuditQueryDto extends createZodDto(
  paginationSchema.extend({
    projectId: z.uuid().optional(),
    entityType: z.string().max(64).optional(),
    entityId: z.uuid().optional(),
  }),
) {}

@ApiTags('audit')
@Controller('v1/orgs/:orgId/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit:read')
  list(@Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: AuditQueryDto) {
    return this.audit.list({ organizationId: orgId, ...q });
  }
}
