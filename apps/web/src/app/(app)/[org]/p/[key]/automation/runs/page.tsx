'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarClock, GitBranch, Hand, Play, Webhook } from 'lucide-react';
import type { AutomationSelection } from '@qaforge/shared';
import {
  describeSelection,
  SelectionPicker,
  selectionValid,
} from '@/components/automation/selection';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import {
  AutomationHeader,
  RunStatusBadge,
  formatMs,
  useAutomationBase,
} from '@/components/automation/shell';
import { useAutomationRuns, useStartRun, type AutomationRunRow } from '@/hooks/automation';
import { useEnvironments } from '@/hooks/qa';
import { useCurrentProject } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';
import { timeAgo } from '@/lib/utils';

const TRIGGER: Record<AutomationRunRow['trigger'], [React.ElementType, string]> = {
  MANUAL: [Hand, 'Manual'],
  SCHEDULE: [CalendarClock, 'Schedule'],
  CI_WEBHOOK: [GitBranch, 'CI'],
  API: [Webhook, 'API'],
};

/** Stacked pass / fail / flaky bar for a run's totals. */
function TotalsBar({ run }: { run: AutomationRunRow }) {
  const t = run.totals;
  if (!t || !t.total)
    return (
      <span className="text-xs text-muted-foreground">
        {run.status === 'QUEUED'
          ? 'Waiting for a worker'
          : run.status === 'RUNNING'
            ? 'Running…'
            : '—'}
      </span>
    );
  const pct = (n: number) => `${(n / t.total) * 100}%`;
  const flakyPassed = Math.min(t.flaky, t.passed);
  return (
    <div className="grid gap-1">
      <div className="flex h-1.5 w-40 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className="bg-success" style={{ width: pct(t.passed - flakyPassed) }} />
        <span className="bg-warning" style={{ width: pct(flakyPassed) }} />
        <span className="bg-destructive" style={{ width: pct(t.failed) }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {t.passed}/{t.total} passed
        {t.failed > 0 && <span className="text-destructive-text"> · {t.failed} failed</span>}
        {t.flaky > 0 && <span className="text-warning-text"> · {t.flaky} flaky</span>}
      </span>
    </div>
  );
}

export default function AutomationRunsPage() {
  const { project } = useCurrentProject();
  const pid = project?.id;
  const runs = useAutomationRuns(pid);
  const canRun = useCan('automation:run');
  const base = useAutomationBase();
  const [open, setOpen] = useState(false);
  const all = runs.data ?? [];
  const finished = all.filter((r) => r.totals?.total);
  const last = finished[0];
  const passRate = last?.totals ? Math.round((last.totals.passed / last.totals.total) * 100) : null;
  const flaky = finished.slice(0, 10).reduce((a, r) => a + (r.totals?.flaky ?? 0), 0);

  return (
    <div className="pb-10">
      <AutomationHeader
        actions={
          canRun && (
            <Button size="sm" onClick={() => setOpen(true)} disabled={!pid}>
              <Play /> Start run
            </Button>
          )
        }
      />
      <div className="grid gap-5 p-6 lg:px-8">
        <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {(
            [
              ['Last run', last ? last.ref : '—', last ? timeAgo(last.createdAt) : 'No runs yet'],
              [
                'Pass rate (last run)',
                passRate === null ? '—' : `${passRate}%`,
                last?.environment?.name ?? 'No environment',
              ],
              ['Flaky results', String(flaky), 'in the last 10 runs'],
              [
                'Running now',
                String(all.filter((r) => r.status === 'RUNNING' || r.status === 'QUEUED').length),
                'queued or running',
              ],
            ] as const
          ).map(([label, value, sub]) => (
            <div key={label} className="rounded-xl border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground">{label}</div>
              {runs.isPending ? (
                <Skeleton className="my-1.5 h-7 w-16" />
              ) : (
                <div className="text-2xl font-bold tabular-nums">{value}</div>
              )}
              <div className="truncate text-xs text-muted-foreground">{sub}</div>
            </div>
          ))}
        </section>
        <section aria-label="Runs" className="overflow-hidden rounded-xl border bg-card">
          {runs.isError ? (
            <ErrorState error={runs.error} retry={() => runs.refetch()} what="automation runs" />
          ) : runs.isPending ? (
            <div className="grid gap-2 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : all.length === 0 ? (
            <EmptyState
              icon={Play}
              title="No automation runs yet"
              description="Start a run here, on a schedule, or from your CI pipeline. Results flow into test runs, and failures can become bugs."
              action={
                canRun && (
                  <Button onClick={() => setOpen(true)}>
                    <Play /> Start run
                  </Button>
                )
              }
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-background text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2">Run</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Results</th>
                  <th className="hidden px-4 py-2 md:table-cell">Trigger</th>
                  <th className="hidden px-4 py-2 lg:table-cell">Environment</th>
                  <th className="hidden px-4 py-2 lg:table-cell">Duration</th>
                </tr>
              </thead>
              <tbody>
                {all.map((r) => {
                  const [Icon, label] = TRIGGER[r.trigger];
                  return (
                    <tr key={r.id} className="border-t hover:bg-accent/40">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`${base}/runs/${r.ref}`}
                          className="font-medium hover:underline"
                        >
                          {r.ref}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {describeSelection(r.selection)}
                          {r.build && ` · build ${r.build}`} · {timeAgo(r.createdAt)}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <RunStatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-2.5">
                        <TotalsBar run={r} />
                      </td>
                      <td className="hidden px-4 py-2.5 md:table-cell">
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Icon className="size-3.5" aria-hidden />
                          {r.schedule ? r.schedule.name : label}
                        </span>
                      </td>
                      <td className="hidden px-4 py-2.5 text-xs lg:table-cell">
                        {r.environment?.name ?? '—'}
                      </td>
                      <td className="hidden px-4 py-2.5 text-xs tabular-nums lg:table-cell">
                        {formatMs(r.totals?.durationMs)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {pid && open && <StartRunDialog projectId={pid} onClose={() => setOpen(false)} />}
    </div>
  );
}

function StartRunDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const envs = useEnvironments(projectId);
  const [selection, setSelection] = useState<AutomationSelection>({ kind: 'all' });
  const [envId, setEnvId] = useState('');
  const [build, setBuild] = useState('');
  const [retries, setRetries] = useState(1);
  const start = useStartRun(projectId);
  const router = useRouter();
  const base = useAutomationBase();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate(
              { selection, environmentId: envId || null, build: build || null, retries },
              { onSuccess: (r) => router.push(`${base}/runs/${r.ref}`) },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Start an automation run</DialogTitle>
            <DialogDescription>
              UI tests run in an isolated browser sandbox. Results for linked test cases go into a
              test run.
            </DialogDescription>
          </DialogHeader>
          <SelectionPicker projectId={projectId} value={selection} onChange={setSelection} />
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm font-medium">
              Environment
              <select
                value={envId}
                onChange={(e) => setEnvId(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">None</option>
                {envs.data?.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Retries for failed tests
              <select
                value={retries}
                onChange={(e) => setRetries(Number(e.target.value))}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="grid gap-1 text-sm font-medium">
            Build (optional)
            <Input
              value={build}
              onChange={(e) => setBuild(e.target.value)}
              placeholder="e.g. 2.14.0 or a commit SHA"
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!selectionValid(selection) || start.isPending}>
              <Play /> {start.isPending ? 'Starting…' : 'Start run'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
