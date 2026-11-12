import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from '../auth/principal';
import { projectCtx, type ProjectCtx } from './project-scope';

/** Injects the resolved project context (requires @RequirePermission on a :projectId route). */
export const Ctx = createParamDecorator((_: unknown, c: ExecutionContext): ProjectCtx =>
  projectCtx(c.switchToHttp().getRequest<AuthedRequest>()),
);
