'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { canAssignRole, ROLE_LABELS, ROLES, type Role } from '@qaforge/shared';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { api } from '@/lib/api';

interface ProjectMemberRow {
  user: { id: string; name: string; email: string; image: string | null };
  orgRole: Role;
  projectRole: Role | null;
  effectiveRole: Role;
}
const INHERIT = '__inherit';

/** Per-project role overrides, e.g. a client who is a Viewer elsewhere but a QA Engineer here. */
export function ProjectMembersCard({
  projectId,
  actorRole,
}: {
  projectId: string;
  actorRole: Role;
}) {
  const qc = useQueryClient();
  const key = ['project', projectId, 'members'];
  const rows = useQuery({
    queryKey: key,
    queryFn: () => api.get<ProjectMemberRow[]>(`/v1/projects/${projectId}/members`),
  });
  const save = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role | null }) =>
      role
        ? api.put(`/v1/projects/${projectId}/members/${userId}`, { role })
        : api.delete(`/v1/projects/${projectId}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const assignable = ROLES.filter((r) => r !== 'OWNER' && canAssignRole(actorRole, r));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">People and roles</CardTitle>
        <CardDescription>
          Everyone in the organization can open this project with their organization role. Override
          it here for this project only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.isError ? (
          <ErrorState
            error={rows.error}
            retry={() => rows.refetch()}
            what="project members"
            className="py-6"
          />
        ) : rows.isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="divide-y rounded-lg border">
            {rows.data!.map((m) => {
              const locked = m.orgRole === 'OWNER' || !canAssignRole(actorRole, m.orgRole);
              return (
                <li key={m.user.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <Avatar name={m.user.name} src={m.user.image} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.user.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {m.user.email} · {ROLE_LABELS[m.orgRole]} in the organization
                    </div>
                  </div>
                  <Select
                    disabled={locked || save.isPending}
                    value={m.projectRole ?? INHERIT}
                    onValueChange={(v) =>
                      save.mutate(
                        { userId: m.user.id, role: v === INHERIT ? null : (v as Role) },
                        {
                          onSuccess: () =>
                            toast.success(
                              `${m.user.name}: ${v === INHERIT ? 'uses organization role' : ROLE_LABELS[v as Role]} in this project`,
                            ),
                          onError: (e) => toast.error(e.message),
                        },
                      )
                    }
                  >
                    <SelectTrigger
                      className="h-8 w-48"
                      aria-label={`Role of ${m.user.name} in this project`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={INHERIT}>
                        Same as organization ({ROLE_LABELS[m.orgRole]})
                      </SelectItem>
                      {assignable.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
