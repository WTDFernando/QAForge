import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@qaforge/shared';
import type { AuthedRequest, Principal } from './principal';

export const IS_PUBLIC = 'qaforge:public';
/** Skip authentication for this route. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_PERMISSION = 'qaforge:permission';
/**
 * Require an org-scoped permission. The org is resolved from `:orgId`, or from
 * `:projectId` (looked up), so handlers can trust `req.membership`.
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal =>
    ctx.switchToHttp().getRequest<AuthedRequest>().principal!,
);
