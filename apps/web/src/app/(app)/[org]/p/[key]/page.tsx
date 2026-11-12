'use client';
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Bug,
  ClipboardCheck,
  FileText,
  MoreHorizontal,
  PlayCircle,
  Rocket,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shell/page-header';
import { useCurrentProject, useUpdateProject } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';
import { AuditTimeline } from '@/components/org/audit-timeline';

/** The traceability chain every project is organized around. Modules light up phase by phase. */
const PIPELINE = [
  { label: 'Requirements', icon: FileText, phase: 2 },
  { label: 'Test cases', icon: ClipboardCheck, phase: 2 },
  { label: 'Test runs', icon: PlayCircle, phase: 4 },
  { label: 'Bugs', icon: Bug, phase: 4 },
  { label: 'Releases', icon: Rocket, phase: 6 },
];

export default function ProjectOverviewPage() {
  const { project, isLoading, org } = useCurrentProject();
  const canUpdate = useCan('project:update');
  const update = useUpdateProject(org?.id ?? '', project?.id ?? '');

  if (isLoading || !org)
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-64" />
      </div>
    );
  if (!project) {
    return (
      <div className="m-auto text-center text-sm text-muted-foreground">Project not found.</div>
    );
  }

  const toggleArchive = async () => {
    await update.mutateAsync({ archived: !project.archivedAt });
    toast.success(project.archivedAt ? 'Project restored' : 'Project archived');
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            {org.name} / <span className="text-foreground">{project.name}</span>
          </>
        }
        title={
          <span className="flex items-center gap-2">
            {project.name}{' '}
            <Badge variant="secondary" className="font-mono">
              {project.key}
            </Badge>
            {project.archivedAt && <Badge variant="warning">Archived</Badge>}
          </span>
        }
        description={project.description}
        actions={
          canUpdate && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="More">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={toggleArchive}>
                  {project.archivedAt ? (
                    <>
                      <ArchiveRestore /> Restore project
                    </>
                  ) : (
                    <>
                      <Archive /> Archive project
                    </>
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />
      <div className="grid gap-6 px-6 pb-10 lg:px-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Traceability</CardTitle>
            <CardDescription>Every item links both ways along this chain.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-wrap items-center gap-2">
              {PIPELINE.map((step, i) => (
                <li key={step.label} className="flex items-center gap-2">
                  <div className="flex min-w-36 items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                    <step.icon className="size-4 text-primary" />
                    <div>
                      <div className="text-sm font-medium">{step.label}</div>
                      <div className="text-xs text-muted-foreground">0 items</div>
                    </div>
                  </div>
                  {i < PIPELINE.length - 1 && (
                    <ArrowRight className="size-4 text-muted-foreground" />
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              <AuditTimeline orgId={org.id} projectId={project.id} compact />
            </CardContent>
          </Card>
          <Card className="border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-fuchsia-500/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4 text-violet-500" /> AI assistant
              </CardTitle>
              <CardDescription>
                Paste a requirement and get draft test cases to review. Arrives with the AI phase.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="ai">Drafts only · you approve</Badge>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
