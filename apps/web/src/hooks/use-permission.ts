'use client';
import { hasPermission, type Permission } from '@qaforge/shared';
import { useCurrentOrg } from './queries';

/** UI-level permission check (the API enforces the same rules server-side). */
export function useCan(permission: Permission): boolean {
  const { org } = useCurrentOrg();
  return !!org && hasPermission(org.role, permission);
}
