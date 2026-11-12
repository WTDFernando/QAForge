'use client';
import Link from 'next/link';
import { FolderKanban, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shell/page-header';
import { useUiState } from '@/components/shell/ui-state';
import { useCurrentOrg, useProjects } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';
import { timeAgo } from '@/lib/utils';

export default function ProjectsPage() {
  const { org } = useCurrentOrg();
  const projects = useProjects(org?.id);
  const canCreate = useCan('project:create');
  const { setCreateProjectOpen } = useUiState();

  const newButton = canCreate && (
    <Button onClick={() => setCreateProjectOpen(true)}>
      <Plus /> New project{' '}
      <Kbd className="ml-1 border-primary-foreground/30 bg-transparent text-primary-foreground/80">
        C
      </Kbd>
    </Button>
  );

  return (
    <>
      <PageHeader
        breadcrumb={org?.name}
        title="Projects"
        description="Everything your team tests, in one place."
        actions={newButton}
      />
      <div className="px-6 pb-10 lg:px-8">
        {projects.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : projects.data?.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 border-dashed p-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FolderKanban />
            </div>
            <div>
              <h2 className="font-semibold">Create your first project</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A project groups requirements, test cases, runs, bugs and releases.
              </p>
            </div>
            {newButton || (
              <p className="text-sm text-muted-foreground">Ask a QA Lead or Admin to create one.</p>
            )}
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.data?.map((p) => (
              <Link
                key={p.id}
                href={`/${org!.slug}/p/${p.key}`}
                className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="h-full p-5 transition-all group-hover:border-primary/40 group-hover:shadow-md">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 px-1.5 font-mono text-[11px] font-bold text-primary">
                      {p.key}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Updated {timeAgo(p.updatedAt)}
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                    {p.description || 'No description'}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
