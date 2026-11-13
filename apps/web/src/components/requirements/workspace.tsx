'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shell/page-header';
import { useCreateAction } from '@/components/shell/ui-state';
import { useCurrentProject } from '@/hooks/queries';
import { useRequirements } from '@/hooks/qa';
import { useCan } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';
import { CreateRequirementDialog } from './create-requirement-dialog';
import { AiJobButton } from '@/components/ai/ai-button';
import { useProjectAgentJobs } from '@/hooks/ai';
import { RequirementTree } from './requirement-tree';

/** Two-pane workspace: tree on the left, the selected requirement (or sources overview) on the right. */
export function RequirementsWorkspace({ children }: { children: React.ReactNode }) {
  const { project, org } = useCurrentProject();
  const { id } = useParams<{ id?: string }>();
  const reqs = useRequirements(project?.id);
  const canEdit = useCan('requirement:write');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const jobs = useProjectAgentJobs(project?.id);
  const bulkJob = jobs.data?.find(
    (j) =>
      j.kind === 'generate-test-cases' &&
      j.sourceIds.length > 1 &&
      (j.status === 'QUEUED' || j.status === 'RUNNING'),
  );
  useCreateAction('New requirement', canEdit ? () => setCreateOpen(true) : null);

  if (!project || !org)
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-64" />
      </div>
    );
  const basePath = `/${org.slug}/p/${project.key}`;
  const selected = reqs.data?.find((r) => r.id === id) ?? null;
  const uncovered = (reqs.data ?? [])
    .filter((r) => r.type === 'STORY' && r.testCaseCount === 0 && r.status !== 'OBSOLETE')
    .map((r) => r.id);

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            {project.name} / <span className="text-foreground">Requirements</span>
          </>
        }
        title="Requirements"
        description="Epics, features and user stories with acceptance criteria."
        actions={
          canEdit && (
            <>
              <Button variant="outline" asChild>
                <a href={`${basePath}/requirements#upload`}>
                  <Upload /> Upload
                </a>
              </Button>
              {uncovered.length > 0 && (
                <AiJobButton
                  projectId={project.id}
                  agent="test-case-writer"
                  size="default"
                  input={{
                    kind: 'generate-test-cases',
                    requirementIds: uncovered.slice(0, 25),
                    maxCasesPerRequirement: 6,
                  }}
                  job={bulkJob}
                  label={`Generate for ${Math.min(uncovered.length, 25)} uncovered stor${uncovered.length === 1 ? 'y' : 'ies'}`}
                />
              )}
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> New requirement
              </Button>
            </>
          )
        }
      />
      <div className="flex min-h-0 flex-1 gap-0 border-t lg:mx-8 lg:mb-8 lg:rounded-xl lg:border">
        <aside
          className={cn(
            'flex w-full flex-col border-r lg:w-80 lg:shrink-0',
            id && 'hidden lg:flex',
          )}
          aria-label="Requirement tree"
        >
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by title or REQ-…"
                className="pl-8"
                aria-label="Filter requirements"
              />
            </div>
          </div>
          <div className="min-h-64 flex-1 overflow-y-auto px-1">
            {reqs.isLoading ? (
              <div className="grid gap-2 p-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-6" />
                ))}
              </div>
            ) : (
              <RequirementTree
                projectId={project.id}
                rows={reqs.data ?? []}
                basePath={basePath}
                selectedId={id}
                query={query}
                canEdit={canEdit}
              />
            )}
          </div>
          {canEdit && (
            <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
              Tip: drag to nest or reorder. Press C to add.
            </p>
          )}
        </aside>
        <section className={cn('min-w-0 flex-1 overflow-y-auto', !id && 'hidden lg:block')}>
          {children}
        </section>
      </div>
      <CreateRequirementDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={project.id}
        basePath={basePath}
        parent={selected}
        requirements={reqs.data ?? []}
      />
    </>
  );
}
