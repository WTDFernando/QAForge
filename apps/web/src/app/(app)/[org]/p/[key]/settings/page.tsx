'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, Globe, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PROJECT_MODULES, moduleEnabled, type ProjectModuleKey } from '@qaforge/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shell/page-header';
import { EnvironmentDialog } from '@/components/projects/environment-dialog';
import { ProjectMembersCard } from '@/components/projects/project-members';
import { useCurrentProject, useUpdateProject } from '@/hooks/queries';
import { useDeleteEnvironment, useEnvironments } from '@/hooks/qa';
import { useCan } from '@/hooks/use-permission';
import type { EnvironmentRow } from '@/lib/types';

export default function ProjectSettingsPage() {
  const { project, org } = useCurrentProject();
  const router = useRouter();
  const canEdit = useCan('project:update');
  const canManageMembers = useCan('members:manage');
  const update = useUpdateProject(org?.id ?? '', project?.id ?? '');
  const envs = useEnvironments(project?.id);
  const delEnv = useDeleteEnvironment(project?.id ?? '');
  const [editing, setEditing] = useState<EnvironmentRow | null | 'new'>(null);
  const [name, setName] = useState<string | null>(null);
  const [desc, setDesc] = useState<string | null>(null);

  if (!project || !org)
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-64" />
      </div>
    );
  if (!canEdit)
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Only QA Leads, Admins and Owners can change project settings.
      </div>
    );

  const saveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({
        name: (name ?? project.name).trim(),
        description: desc ?? project.description ?? undefined,
      });
      toast.success('Project updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    }
  };
  const toggleModule = (key: ProjectModuleKey, on: boolean) =>
    update.mutate(
      { modules: { [key]: on } },
      {
        onSuccess: () => toast.success(on ? 'Module enabled' : 'Module hidden'),
        onError: (e) => toast.error(e.message),
      },
    );
  const archive = async () => {
    await update.mutateAsync({ archived: !project.archivedAt });
    toast.success(project.archivedAt ? 'Project restored' : 'Project archived');
    if (!project.archivedAt) router.push(`/${org.slug}`);
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            {project.name} / <span className="text-foreground">Settings</span>
          </>
        }
        title="Project settings"
      />
      <div className="grid max-w-3xl gap-6 px-6 pb-10 lg:px-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">General</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveGeneral} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <FormField id="p-name" label="Name">
                  <Input
                    id="p-name"
                    value={name ?? project.name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </FormField>
                <FormField id="p-key" label="Key" hint="Fixed after creation">
                  <Input id="p-key" value={project.key} disabled className="font-mono" />
                </FormField>
              </div>
              <FormField id="p-desc" label="Description">
                <Textarea
                  id="p-desc"
                  rows={2}
                  value={desc ?? project.description ?? ''}
                  onChange={(e) => setDesc(e.target.value)}
                />
              </FormField>
              <div>
                <Button
                  type="submit"
                  disabled={update.isPending || (name === null && desc === null)}
                >
                  Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Environments</CardTitle>
              <CardDescription className="mt-1">
                Where tests run: Dev, Staging, Prod. Runs and automation pick one of these.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus /> Add
            </Button>
          </CardHeader>
          <CardContent>
            {envs.isLoading ? (
              <Skeleton className="h-16" />
            ) : !envs.data?.length ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                No environments yet. Add Dev, Staging and Prod with their base URLs.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {envs.data.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <Globe className="size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{e.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {e.baseUrl ?? 'No base URL'} · {Object.keys(e.variables).length} variables
                      </div>
                    </div>
                    {e.secretKeys.length > 0 && (
                      <Badge variant="secondary">
                        <KeyRound className="size-3" /> {e.secretKeys.length} secrets
                      </Badge>
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Edit ${e.name}`}
                      onClick={() => setEditing(e)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${e.name}`}
                      onClick={() =>
                        delEnv.mutate(e.id, { onSuccess: () => toast.success(`${e.name} deleted`) })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Modules</CardTitle>
            <CardDescription>
              Choose what appears in this project&apos;s sidebar. Labs modules are previews of
              upcoming features.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {PROJECT_MODULES.map((m) => (
              <label key={m.key} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <Checkbox
                  checked={moduleEnabled(project.settings, m.key)}
                  onCheckedChange={(c) => toggleModule(m.key, c === true)}
                  disabled={m.key === 'requirements' || m.key === 'testCases'}
                />
                <span className="flex-1">{m.label}</span>
                {'future' in m ? (
                  <Badge variant="outline">Labs</Badge>
                ) : (
                  !m.available && <Badge variant="outline">Coming</Badge>
                )}
              </label>
            ))}
          </CardContent>
        </Card>

        {canManageMembers && <ProjectMembersCard projectId={project.id} actorRole={org.role} />}

        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base">
              {project.archivedAt ? 'Restore project' : 'Archive project'}
            </CardTitle>
            <CardDescription>
              {project.archivedAt
                ? 'Make the project active again.'
                : 'Hides the project from lists. Nothing is deleted and you can restore it any time.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={archive}>
              {project.archivedAt ? (
                <>
                  <ArchiveRestore /> Restore
                </>
              ) : (
                <>
                  <Archive /> Archive
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
      <EnvironmentDialog
        projectId={project.id}
        env={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </>
  );
}
