import type { Role } from '@qaforge/shared';

export interface Me {
  user: { id: string; name: string; email: string; image: string | null };
  organizations: Array<{ id: string; name: string; slug: string; role: Role }>;
  pendingInvitations: Array<{ id: string; role: Role; organization: { name: string } }>;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  key: string;
  description: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  id: string;
  role: Role;
  createdAt: string;
  user: { id: string; name: string; email: string; image: string | null };
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  actorType: 'USER' | 'API_TOKEN' | 'AI_AGENT' | 'SYSTEM';
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  metadata: Record<string, unknown> | null;
  projectId: string | null;
  createdAt: string;
}
