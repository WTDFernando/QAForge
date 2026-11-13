'use client';
import Link from 'next/link';
import { Bot, CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
import { AGENT_INFO, type AgentJobEvent } from '@qaforge/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCancelAgentJob, useOrgAgentJobs } from '@/hooks/ai';
import { useCurrentOrg, useProjects } from '@/hooks/queries';
import { cn, timeAgo } from '@/lib/utils';

function JobRow({ job, projectKey }: { job: AgentJobEvent; projectKey?: string }) {
  const cancel = useCancelAgentJob(job.projectId ?? '');
  const active = job.status === 'QUEUED' || job.status === 'RUNNING';
  const { org } = useCurrentOrg();
  const href =
    projectKey && org
      ? `/${org.slug}/p/${projectKey}/${job.kind === 'generate-test-cases' ? 'test-cases?view=review' : job.kind === 'review-test-case' ? 'test-cases' : 'requirements'}`
      : undefined;
  return (
    <li className="grid gap-1.5 py-2.5">
      <div className="flex items-start gap-2 text-sm">
        {active ? (
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
        ) : job.status === 'SUCCEEDED' ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
        ) : (
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium">{AGENT_INFO[job.agent].name}</div>
          <div className="text-xs text-muted-foreground">
            {active
              ? (job.progressMessage ?? 'Working')
              : job.status === 'SUCCEEDED'
                ? job.summary
                : job.status === 'CANCELLED'
                  ? 'Cancelled'
                  : job.error}
            {' · '}
            {timeAgo(job.createdAt)}
          </div>
        </div>
        {active && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Cancel job"
            onClick={() => cancel.mutate(job.id)}
          >
            <X />
          </Button>
        )}
      </div>
      {active && (
        <div
          className="ml-6 h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={job.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progress"
        >
          <div
            className="h-full bg-primary transition-[width] duration-500"
            style={{ width: `${Math.max(job.progress, 4)}%` }}
          />
        </div>
      )}
      {job.status === 'SUCCEEDED' && href && (
        <Link href={href} className="ml-6 text-xs text-primary hover:underline">
          Review results
        </Link>
      )}
    </li>
  );
}

/** Top-bar indicator: live AI agent jobs for this organization. */
export function AgentActivity() {
  const { org } = useCurrentOrg();
  const jobs = useOrgAgentJobs(org?.id);
  const projects = useProjects(org?.id);
  const list = jobs.data ?? [];
  const running = list.filter((j) => j.status === 'QUEUED' || j.status === 'RUNNING').length;
  const keyOf = (pid: string | null) => projects.data?.find((p) => p.id === pid)?.key;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={running ? 'sm' : 'icon-sm'}
          className={cn(running && 'gap-1.5 text-primary')}
          aria-label={running ? `AI agents: ${running} running` : 'AI agent activity: idle'}
        >
          {running ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
          {running > 0 && <span className="text-xs font-medium">{running}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <p className="text-sm font-medium">AI agents</p>
        {list.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            No agent activity yet. Generate test cases from a requirement or analyze an uploaded
            document to start.
          </p>
        ) : (
          <ul className="divide-y">
            {list.slice(0, 8).map((j) => (
              <JobRow key={j.id} job={j} projectKey={keyOf(j.projectId)} />
            ))}
          </ul>
        )}
        <p className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
          Everything AI creates arrives as a draft for you to review.
        </p>
      </PopoverContent>
    </Popover>
  );
}
