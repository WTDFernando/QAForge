'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { MoreHorizontal, PlayCircle, Plus, Search } from 'lucide-react';
import type { TestRunStatus } from '@qaforge/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { PageHeader } from '@/components/shell/page-header';
import { useCreateAction } from '@/components/shell/ui-state';
import { CreateRunDialog } from '@/components/runs/create-run-dialog';
import { RunProgressBar, RunStatusPill } from '@/components/qa/run-status';
import { useCurrentProject } from '@/hooks/queries';
import { useTestRuns } from '@/hooks/runs';
import { useCan } from '@/hooks/use-permission';
import type { TestRunRow } from '@/lib/types';
import { cn } from '@/lib/utils';

const TABS: { key: string; label: string; statuses: TestRunStatus[] }[] = [
  { key: 'active', label: 'Active', statuses: ['IN_PROGRESS'] },
  { key: 'planned', label: 'Planned', statuses: ['PLANNED'] },
  { key: 'done', label: 'Completed', statuses: ['COMPLETED', 'ABORTED'] },
];

function dueLabel(run: TestRunRow) {
  if (!run.dueAt) return { text: '—', overdue: false };
  const d = new Date(run.dueAt);
  const overdue = d < new Date() && (run.status === 'IN_PROGRESS' || run.status === 'PLANNED');
  const text = d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return { text: overdue ? `${text} · overdue` : text, overdue };
}

export default function RunsPage() {
  const { project, org } = useCurrentProject();
  const canCreate = useCan('run:create');
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const runs = useTestRuns(project?.id);
  useCreateAction('New test run', canCreate ? () => setCreateOpen(true) : null);
  const base = project && org ? `/${org.slug}/p/${project.key}` : '';

  const all = useMemo(() => runs.data?.items ?? [], [runs.data]);
  const counts = Object.fromEntries(
    TABS.map((t) => [t.key, all.filter((r) => t.statuses.includes(r.status)).length]),
  );
  const visible = all.filter(
    (r) =>
      TABS.find((t) => t.key === tab)!.statuses.includes(r.status) &&
      (!q || `${r.ref} ${r.name} ${r.build ?? ''}`.toLowerCase().includes(q.toLowerCase())),
  );
  const active = all.filter((r) => r.status === 'IN_PROGRESS');
  const lastWithRate = all.find((r) => r.counts.passRate !== null);
  const failed = active.reduce((a, r) => a + r.counts.byStatus.FAILED, 0);

  return (
    <div className="pb-10">
      <PageHeader
        breadcrumb={project?.name}
        title="Test runs"
        description="Plan a run from a suite or a filter, then execute it with P, F, B and S."
        actions={
          canCreate && (
            <Button onClick={() => setCreateOpen(true)} disabled={!project}>
              <Plus /> New run
            </Button>
          )
        }
      />
      <div className="grid gap-5 px-6 lg:px-8">
        <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            [
              'Active runs',
              String(active.length),
              `${all.filter((r) => r.status === 'PLANNED').length} planned`,
              '',
            ],
            [
              'Pass rate (latest run)',
              lastWithRate ? `${lastWithRate.counts.passRate}%` : '—',
              lastWithRate
                ? `${lastWithRate.ref} · ${lastWithRate.counts.executed} executed`
                : 'No results yet',
              lastWithRate && (lastWithRate.counts.passRate ?? 0) < 80
                ? 'text-destructive-text'
                : 'text-success-text',
            ],
            [
              'Failed tests',
              String(failed),
              `across ${active.length} active run${active.length === 1 ? '' : 's'}`,
              failed ? 'text-destructive-text' : '',
            ],
            ['Completed runs', String(counts.done), 'all time', ''],
          ].map(([label, value, sub, cls]) => (
            <div key={label} className="rounded-xl border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground">{label}</div>
              {runs.isPending ? (
                <Skeleton className="my-1.5 h-7 w-16" />
              ) : (
                <div className={cn('text-2xl font-bold tabular-nums', cls)}>{value}</div>
              )}
              <div className="truncate text-xs text-muted-foreground">{sub}</div>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-xl border bg-card" aria-label="Runs">
          <div className="flex flex-wrap items-center gap-4 border-b px-4">
            <div role="tablist" aria-label="Run status" className="flex gap-4">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    '-mb-px flex items-center gap-1.5 border-b-2 py-3 text-sm',
                    tab === t.key
                      ? 'border-primary font-semibold'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[11px] font-semibold',
                      tab === t.key
                        ? 'bg-primary-subtle text-primary'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {counts[t.key]}
                  </span>
                </button>
              ))}
            </div>
            <div className="relative ml-auto py-2">
              <Search
                className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search runs"
                aria-label="Search runs"
                className="h-8 w-56 pl-8"
              />
            </div>
          </div>
          {runs.isError ? (
            <ErrorState error={runs.error} retry={() => runs.refetch()} what="test runs" />
          ) : runs.isPending ? (
            <div className="grid gap-2 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={PlayCircle}
              title={
                all.length === 0
                  ? 'No test runs yet'
                  : q
                    ? 'No runs match'
                    : `No ${TABS.find((t) => t.key === tab)!.label.toLowerCase()} runs`
              }
              description={
                all.length === 0
                  ? 'Create a run from a suite to start executing tests and tracking pass rate.'
                  : undefined
              }
              action={
                all.length === 0 &&
                canCreate && (
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus /> New run
                  </Button>
                )
              }
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-background text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2 font-semibold">Run</th>
                  <th className="px-4 py-2 font-semibold">Progress</th>
                  <th className="hidden px-4 py-2 font-semibold md:table-cell">Environment</th>
                  <th className="hidden px-4 py-2 font-semibold lg:table-cell">Due</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const due = dueLabel(r);
                  return (
                    <tr key={r.id} className="group border-t hover:bg-accent/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {r.ref}
                          </span>
                          <RunStatusPill status={r.status} />
                        </div>
                        <Link
                          href={`${base}/runs/${r.ref}`}
                          className="font-semibold hover:underline focus-visible:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="w-[38%] px-4 py-3">
                        <RunProgressBar counts={r.counts} />
                        <div className="mt-1.5 flex justify-between text-xs">
                          <span className="text-muted-foreground">
                            {r.counts.executed} of {r.counts.total} done
                          </span>
                          <span
                            className={cn(
                              'font-semibold',
                              r.counts.passRate === null
                                ? 'text-muted-foreground'
                                : r.counts.passRate >= 80
                                  ? 'text-success-text'
                                  : 'text-destructive-text',
                            )}
                          >
                            {r.counts.passRate === null
                              ? 'Not started'
                              : `${r.counts.passRate}% pass`}
                          </span>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <div className="font-medium">{r.environment?.name ?? '—'}</div>
                        {r.build && (
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {r.build}
                          </div>
                        )}
                      </td>
                      <td
                        className={cn(
                          'hidden px-4 py-3 text-xs lg:table-cell',
                          due.overdue
                            ? 'font-semibold text-destructive-text'
                            : 'text-muted-foreground',
                        )}
                      >
                        {due.text}
                      </td>
                      <td className="px-2">
                        <Button asChild variant="ghost" size="icon-sm" aria-label={`Open ${r.ref}`}>
                          <Link href={`${base}/runs/${r.ref}`}>
                            <MoreHorizontal />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {project && org && (
        <CreateRunDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          projectId={project.id}
          orgId={org.id}
          basePath={base}
        />
      )}
    </div>
  );
}
