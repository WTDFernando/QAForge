import type { Request } from 'express';
import type { Role } from '@qaforge/shared';

export interface Principal {
  type: 'USER';
  userId: string;
  email: string;
  name: string;
  sessionId: string;
}

export interface ResolvedMembership {
  organizationId: string;
  role: Role;
  /** Set when the route was scoped by :projectId. */
  projectId?: string;
}

export interface AuthedRequest extends Request {
  principal?: Principal;
  membership?: ResolvedMembership;
}
