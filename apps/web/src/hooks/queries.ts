'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import type {
  CreateOrganizationInput,
  CreateProjectInput,
  InviteMemberInput,
  Role,
  UpdateOrganizationInput,
  UpdateProjectInput,
} from '@qaforge/shared';
import { api } from '@/lib/api';
import type { AuditEntry, Invitation, Me, Member, Organization, Project } from '@/lib/types';

export const keys = {
  me: ['me'] as const,
  projects: (orgId: string) => ['orgs', orgId, 'projects'] as const,
  members: (orgId: string) => ['orgs', orgId, 'members'] as const,
  invitations: (orgId: string) => ['orgs', orgId, 'invitations'] as const,
  audit: (orgId: string, filter: Record<string, string | undefined>) =>
    ['orgs', orgId, 'audit', filter] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api.get<Me>('/v1/me') });
}

/** Current org from the `[org]` slug in the URL. */
export function useCurrentOrg(): {
  org: Organization | undefined;
  isLoading: boolean;
  notFound: boolean;
} {
  const params = useParams<{ org?: string }>();
  const me = useMe();
  const org = me.data?.organizations.find((o) => o.slug === params.org);
  return { org, isLoading: me.isLoading, notFound: !!me.data && !!params.org && !org };
}

export function useProjects(orgId: string | undefined, includeArchived = false) {
  return useQuery({
    queryKey: [...keys.projects(orgId ?? ''), { includeArchived }],
    queryFn: () =>
      api.get<Project[]>(
        `/v1/orgs/${orgId}/projects${includeArchived ? '?includeArchived=true' : ''}`,
      ),
    enabled: !!orgId,
  });
}

export function useCurrentProject() {
  const params = useParams<{ key?: string }>();
  const { org } = useCurrentOrg();
  const projects = useProjects(org?.id);
  return {
    project: projects.data?.find((p) => p.key === params.key),
    isLoading: projects.isLoading,
    org,
  };
}

export function useCreateOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrganizationInput) => api.post<Organization>('/v1/orgs', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useUpdateOrg(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateOrganizationInput) =>
      api.patch<Organization>(`/v1/orgs/${orgId}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useCreateProject(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      api.post<Project>(`/v1/orgs/${orgId}/projects`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects(orgId) }),
  });
}

export function useUpdateProject(orgId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      api.patch<Project>(`/v1/projects/${projectId}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects(orgId) }),
  });
}

export function useMembers(orgId: string | undefined) {
  return useQuery({
    queryKey: keys.members(orgId ?? ''),
    queryFn: () => api.get<Member[]>(`/v1/orgs/${orgId}/members`),
    enabled: !!orgId,
  });
}

export function useInvitations(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.invitations(orgId ?? ''),
    queryFn: () => api.get<Invitation[]>(`/v1/orgs/${orgId}/invitations`),
    enabled: !!orgId && enabled,
  });
}

export function useInvite(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteMemberInput) =>
      api.post<Invitation>(`/v1/orgs/${orgId}/invitations`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invitations(orgId) }),
  });
}

export function useRevokeInvite(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/orgs/${orgId}/invitations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invitations(orgId) }),
  });
}

export function useUpdateMemberRole(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: Role }) =>
      api.patch(`/v1/orgs/${orgId}/members/${memberId}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(orgId) }),
  });
}

export function useRemoveMember(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => api.delete(`/v1/orgs/${orgId}/members/${memberId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(orgId) }),
  });
}

export function useAudit(
  orgId: string | undefined,
  filter: { projectId?: string; entityType?: string } = {},
) {
  return useQuery({
    queryKey: keys.audit(orgId ?? '', filter),
    queryFn: () => {
      const qs = new URLSearchParams({
        limit: '100',
        ...Object.fromEntries(Object.entries(filter).filter(([, v]) => v)),
      });
      return api.get<{ items: AuditEntry[]; nextCursor: string | null }>(
        `/v1/orgs/${orgId}/audit?${qs}`,
      );
    },
    enabled: !!orgId,
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ organizationId: string }>(`/v1/invitations/${id}/accept`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}
