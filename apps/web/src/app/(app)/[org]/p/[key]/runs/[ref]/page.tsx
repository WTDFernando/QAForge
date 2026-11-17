'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Ban,
  Bug,
  Camera,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  Lock,
  RotateCcw,
  Search,
  SkipForward,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { humanize, type ResultStatus, type StepResult } from '@qaforge/shared';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Topbar } from '@/components/shell/topbar';
import { BugFormDialog, type BugFormInitial } from '@/components/bugs/bug-form-dialog';
import {
  RESULT_META,
  ResultGlyph,
  RunLegend,
  RunProgressBar,
  RunStatusPill,
} from '@/components/qa/run-status';
import { useCurrentProject, useMe, useMembers } from '@/hooks/queries';
import {
  useRecordResult,
  useRunResult,
  useRunResults,
  useTestRunByRef,
  useUpdateTestRun,
  useUploadEvidence,
} from '@/hooks/runs';
import { useHotkey } from '@/hooks/use-hotkey';
import { useCan } from '@/hooks/use-permission';
import type { RunResultDetail, RunResultRow, TestRunRow } from '@/lib/types';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'mine' | 'failed' | 'untested';
const RESULT_KEYS: [ResultStatus, string, React.ElementType][] = [
  ['PASSED', 'p', Check],
  ['FAILED', 'f', X],
  ['BLOCKED', 'b', Ban],
  ['SKIPPED', 's', SkipForward],
];
const BTN: Record<string, string> = {
  PASSED: 'bg-success text-white hover:bg-success/90',
  FAILED: 'bg-destructive text-white hover:bg-destructive/90',
  BLOCKED: 'border bg-card text-blocked-text hover:bg-blocked-subtle',
  SKIPPED: 'border bg-card text-muted-foreground hover:bg-muted',
};

export default function RunExecutionPage() {
  const { ref } = useParams<{ ref: string }>();
  const { project, org } = useCurrentProject();
  const run = useTestRunByRef(project?.id, ref?.toUpperCase());
  if (run.isError)
    return (
      <>
        <Topbar />
        <ErrorState error={run.error} retry={() => run.refetch()} what={`run ${ref}`} />
      </>
    );
  if (!project || !org || !run.data)
    return (
      <>
        <Topbar />
        <div className="grid gap-3 p-6">
          <Skeleton className="h-8 w-80" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </>
    );
  return (
    <Execution
      run={run.data}
      projectId={project.id}
      orgId={org.id}
      base={`/${org.slug}/p/${project.key}`}
    />
  );
}

function Execution({
  run,
  projectId,
  orgId,
  base,
}: {
  run: TestRunRow;
  projectId: string;
  orgId: string;
  base: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const me = useMe();
  const members = useMembers(orgId);
  const canExecute = useCan('run:execute');
  const canManage = useCan('run:create');
  const results = useRunResults(projectId, run.id);
  const update = useUpdateTestRun(projectId, run.id);
  const record = useRecordResult(projectId, run.id);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const closed = run.status === 'COMPLETED' || run.status === 'ABORTED';
  const readOnly = closed || !canExecute;

  const rows = useMemo(() => results.data ?? [], [results.data]);
  const myId = me.data?.user.id;
  const visible = rows.filter((r) => {
    if (filter === 'mine' && r.assigneeId !== myId) return false;
    if (filter === 'failed' && r.status !== 'FAILED') return false;
    if (filter === 'untested' && r.status !== 'UNTESTED' && r.status !== 'RETEST') return false;
    const t = q.trim().toLowerCase();
    return !t || r.title.toLowerCase().includes(t) || r.ref.toLowerCase().includes(t);
  });
  const selectedId = params.get('result') ?? visible[0]?.id ?? rows[0]?.id;
  const select = useCallback(
    (id: string) => router.replace(`${pathname}?result=${id}`, { scroll: false }),
    [router, pathname],
  );
  const idx = rows.findIndex((r) => r.id === selectedId);
  const nextUntested = useCallback(
    (from = idx) => {
      const order = [...rows.slice(from + 1), ...rows.slice(0, Math.max(from, 0))];
      return order.find((r) => r.status === 'UNTESTED' || r.status === 'RETEST');
    },
    [rows, idx],
  );
  const move = useCallback(
    (d: 1 | -1) => {
      const list = visible.length ? visible : rows;
      const i = list.findIndex((r) => r.id === selectedId);
      const n = list[Math.min(list.length - 1, Math.max(0, i + d))];
      if (n) select(n.id);
    },
    [visible, rows, selectedId, select],
  );
  useHotkey('j', () => move(1));
  useHotkey('k', () => move(-1));

  const people = new Map(members.data?.map((m) => [m.user.id, m.user]) ?? []);
  const counts = useMemo(() => {
    const byStatus = Object.fromEntries(Object.keys(RESULT_META).map((s) => [s, 0])) as Record<
      ResultStatus,
      number
    >;
    for (const r of rows) byStatus[r.status]++;
    const executed = byStatus.PASSED + byStatus.FAILED + byStatus.BLOCKED + byStatus.SKIPPED;
    const denom = byStatus.PASSED + byStatus.FAILED + byStatus.BLOCKED;
    return {
      total: rows.length,
      byStatus,
      executed,
      progressPct: rows.length ? Math.round((executed / rows.length) * 100) : 0,
      passRate: denom ? Math.round((byStatus.PASSED / denom) * 1000) / 10 : null,
    };
  }, [rows]);
  const liveCounts = results.data ? counts : run.counts;

  const setRunStatus = async (status: 'COMPLETED' | 'IN_PROGRESS') => {
    try {
      await update.mutateAsync({ status });
      toast.success(status === 'COMPLETED' ? `${run.ref} closed` : `${run.ref} reopened`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the run');
    }
  };

  return (
    <div className="flex h-dvh flex-col">
      <Topbar>
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1.5 truncate text-sm text-muted-foreground"
        >
          <Link href={`${base}/runs`} className="hover:text-foreground">
            Test runs
          </Link>
          <ChevronRight className="size-3.5" aria-hidden />
          <span className="font-medium text-foreground">{run.ref}</span>
        </nav>
      </Topbar>
      <header className="border-b bg-card px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-sm text-muted-foreground">{run.ref}</span>
              <h1 className="truncate text-xl font-semibold tracking-tight">{run.name}</h1>
              <RunStatusPill status={run.status} />
            </div>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {run.environment && <span>Environment: {run.environment.name}</span>}
              {run.build && <span>Build {run.build}</span>}
              {run.dueAt && (
                <span>
                  Due{' '}
                  {new Date(run.dueAt).toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              )}
            </p>
          </div>
          {canManage &&
            (closed ? (
              <Button
                variant="outline"
                onClick={() => setRunStatus('IN_PROGRESS')}
                disabled={update.isPending}
              >
                <RotateCcw /> Reopen run
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => setRunStatus('COMPLETED')}
                disabled={update.isPending}
              >
                <Lock /> Close run
              </Button>
            ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="min-w-64 flex-1">
            <RunProgressBar counts={liveCounts} />
            <div className="mt-2">
              <RunLegend counts={liveCounts} />
            </div>
          </div>
          <div className="text-right">
            <div
              className={cn(
                'text-2xl font-bold tabular-nums',
                liveCounts.passRate === null
                  ? 'text-muted-foreground'
                  : liveCounts.passRate >= 80
                    ? 'text-success-text'
                    : 'text-destructive-text',
              )}
            >
              {liveCounts.passRate === null ? '—' : `${liveCounts.passRate}%`}
            </div>
            <div className="text-xs text-muted-foreground">
              pass rate · {liveCounts.executed} of {liveCounts.total} done
            </div>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className="hidden w-[22rem] shrink-0 flex-col border-r bg-card md:flex"
          aria-label="Cases in this run"
        >
          <div className="grid gap-2.5 p-3">
            <div
              role="tablist"
              aria-label="Filter cases"
              className="grid grid-cols-4 gap-0.5 rounded-lg bg-muted p-[3px]"
            >
              {(
                [
                  ['all', 'All', rows.length],
                  ['mine', 'Mine', rows.filter((r) => r.assigneeId === myId).length],
                  ['failed', 'Failed', counts.byStatus.FAILED],
                  ['untested', 'Untested', counts.byStatus.UNTESTED + counts.byStatus.RETEST],
                ] as const
              ).map(([k, label, n]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={filter === k}
                  onClick={() => setFilter(k)}
                  className={cn(
                    'rounded-md px-1 py-1 text-xs font-medium',
                    filter === k
                      ? 'bg-card font-semibold shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label} <span className="font-normal text-muted-foreground">{n}</span>
                </button>
              ))}
            </div>
            <div className="relative">
              <Search
                className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter cases"
                aria-label="Filter cases"
                className="h-8 pl-8"
              />
            </div>
          </div>
          <ul className="flex-1 overflow-y-auto px-2 pb-3" aria-label="Cases">
            {results.isLoading &&
              [0, 1, 2, 3].map((i) => (
                <li key={i}>
                  <Skeleton className="my-1 h-11" />
                </li>
              ))}
            {!results.isLoading && visible.length === 0 && (
              <li className="px-3 py-8 text-center text-sm text-muted-foreground">
                No cases match this filter.
              </li>
            )}
            {visible.map((r) => {
              const who = r.assigneeId ? people.get(r.assigneeId) : undefined;
              const sel = r.id === selectedId;
              return (
                <li key={r.id}>
                  <button
                    onClick={() => select(r.id)}
                    aria-current={sel ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg border-l-[3px] px-2 py-1.5 text-left',
                      sel ? 'border-primary bg-accent' : 'border-transparent hover:bg-accent/60',
                    )}
                  >
                    <ResultGlyph status={r.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {r.ref}
                        {r.dataRow && ` · row ${(r.dataRowIndex ?? 0) + 1}`}
                      </span>
                      <span
                        className={cn(
                          'block truncate text-sm',
                          sel ? 'font-semibold' : 'font-medium',
                        )}
                      >
                        {r.title}
                      </span>
                    </span>
                    {r.bugCount > 0 && (
                      <span
                        className="flex items-center gap-0.5 text-xs text-destructive-text"
                        title={`${r.bugCount} bug${r.bugCount === 1 ? '' : 's'}`}
                      >
                        <Bug className="size-3" aria-hidden />
                        {r.bugCount}
                      </span>
                    )}
                    {who && <Avatar name={who.name} src={who.image} className="size-5" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
            <Kbd>J</Kbd> <Kbd>K</Kbd> move · <Kbd>P</Kbd> <Kbd>F</Kbd> <Kbd>B</Kbd> <Kbd>S</Kbd>{' '}
            record · <Kbd>N</Kbd> next untested
          </p>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {results.isError ? (
            <ErrorState
              error={results.error}
              retry={() => results.refetch()}
              what="the cases in this run"
            />
          ) : rows.length === 0 && !results.isLoading ? (
            <EmptyState
              icon={Check}
              title="This run has no tests"
              description="Add cases from the test case list, or create a new run from a suite."
            />
          ) : selectedId ? (
            <CasePane
              key={selectedId}
              projectId={projectId}
              runId={run.id}
              resultId={selectedId}
              row={rows[idx]}
              position={idx + 1}
              total={rows.length}
              base={base}
              readOnly={readOnly}
              closed={closed}
              record={record}
              onNext={(status) => {
                const n = nextUntested();
                if (n && status !== 'FAILED') select(n.id);
              }}
              goNextUntested={() => {
                const n = nextUntested();
                if (n) select(n.id);
                else toast.success('Every case in this run has a result');
              }}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}

function CasePane({
  projectId,
  resultId,
  row,
  position,
  total,
  base,
  readOnly,
  closed,
  record,
  onNext,
  goNextUntested,
}: {
  projectId: string;
  runId: string;
  resultId: string;
  row: RunResultRow | undefined;
  position: number;
  total: number;
  base: string;
  readOnly: boolean;
  closed: boolean;
  record: ReturnType<typeof useRecordResult>;
  onNext: (status: ResultStatus) => void;
  goNextUntested: () => void;
}) {
  const detail = useRunResult(projectId, resultId);
  if (detail.isError)
    return <ErrorState error={detail.error} retry={() => detail.refetch()} what="this result" />;
  if (!detail.data)
    return (
      <div className="grid gap-4 p-7">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );
  return (
    <CaseBody
      d={detail.data}
      refetch={() => void detail.refetch()}
      {...{
        projectId,
        resultId,
        row,
        position,
        total,
        base,
        readOnly,
        closed,
        record,
        onNext,
        goNextUntested,
      }}
    />
  );
}

function CaseBody({
  d,
  refetch,
  projectId,
  resultId,
  row,
  position,
  total,
  base,
  readOnly,
  closed,
  record,
  onNext,
  goNextUntested,
}: {
  d: RunResultDetail;
  refetch: () => void;
  projectId: string;
  resultId: string;
  row: RunResultRow | undefined;
  position: number;
  total: number;
  base: string;
  readOnly: boolean;
  closed: boolean;
  record: ReturnType<typeof useRecordResult>;
  onNext: (status: ResultStatus) => void;
  goNextUntested: () => void;
}) {
  const upload = useUploadEvidence(projectId, resultId);
  // Local edits start from the server copy; the pane is keyed by result, so switching cases resets them.
  const [steps, setSteps] = useState<StepResult[]>(() => d.stepResults ?? []);
  const [notes, setNotes] = useState(() => d.notes ?? '');
  const [bugOpen, setBugOpen] = useState<BugFormInitial | null>(null);
  const [seconds, setSeconds] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Execution timer for this case (saved as durationSec with the result).
  useEffect(() => {
    if (readOnly) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [readOnly]);

  const save = useCallback(
    async (status?: ResultStatus, extra: { stepResults?: StepResult[]; notes?: string } = {}) => {
      try {
        await record.mutateAsync({
          id: resultId,
          ...(status && { status, durationSec: (d.durationSec ?? 0) + seconds }),
          ...extra,
        });
        if (status) {
          setSeconds(0);
          onNext(status);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not save the result');
      }
    },
    [record, resultId, d.durationSec, seconds, onNext],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      for (const f of files) {
        try {
          await upload.mutateAsync(f);
          toast.success(`${f.name || 'Screenshot'} attached`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Upload failed');
        }
      }
    },
    [upload],
  );

  const enabled = !readOnly;
  useHotkey('p', () => save('PASSED'), enabled);
  useHotkey('f', () => save('FAILED'), enabled);
  useHotkey('b', () => save('BLOCKED'), enabled);
  useHotkey('s', () => save('SKIPPED'), enabled);
  useHotkey('n', goNextUntested);

  // Paste screenshots straight into the evidence (Ctrl/Cmd + V).
  useEffect(() => {
    if (!enabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      void addFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [enabled, addFiles]);

  const snap = d.snapshot;
  const stepStatus = (i: number) => steps.find((s) => s.index === i);
  const setStep = (i: number, status: ResultStatus) => {
    const cur = stepStatus(i);
    const next =
      cur?.status === status
        ? steps.filter((s) => s.index !== i)
        : [
            ...steps.filter((s) => s.index !== i),
            { index: i, status, actual: cur?.actual ?? '' },
          ].sort((a, b) => a.index - b.index);
    setSteps(next);
    void save(undefined, { stepResults: next });
  };
  const setActual = (i: number, actual: string) =>
    setSteps(steps.map((s) => (s.index === i ? { ...s, actual } : s)));
  const failedIdx = steps.find((s) => s.status === 'FAILED')?.index;
  const reportFrom = (i?: number) => {
    const step = i !== undefined ? snap.steps[i] : undefined;
    const actual = i !== undefined ? stepStatus(i)?.actual : '';
    setBugOpen({
      title: step ? `${snap.title}: ${step.action}` : snap.title,
      stepsToReproduce: snap.steps.slice(0, (i ?? snap.steps.length - 1) + 1).map((s) => s.action),
      expectedResult: step?.expected ?? '',
      actualResult: actual ?? '',
      severity: snap.priority === 'CRITICAL' || snap.priority === 'HIGH' ? 'CRITICAL' : 'MAJOR',
      priority: snap.priority,
      context: `From ${snap.ref}${i !== undefined ? `, step ${i + 1}` : ''}. The run’s environment and build are added automatically.`,
      extra: { testRunResultId: resultId, failedStepIndex: i ?? null },
    });
  };
  const dataRow = row?.dataRow;
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <>
      <div className="flex-1 overflow-y-auto px-7 py-5">
        <div className="mx-auto grid max-w-4xl gap-5">
          <div className="grid gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{snap.ref}</span>·
              <span>
                Case {position} of {total}
              </span>
              {d.testCaseId && (
                <Link
                  href={`${base}/test-cases/${snap.ref}`}
                  className="ml-auto inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                >
                  <ExternalLink className="size-3.5" aria-hidden /> Open case
                </Link>
              )}
            </div>
            <h2 className="text-xl font-semibold tracking-tight">{snap.title}</h2>
            <div className="flex flex-wrap gap-1.5 text-xs font-medium">
              <span
                className={cn(
                  'rounded-md px-2 py-0.5',
                  snap.priority === 'CRITICAL' || snap.priority === 'HIGH'
                    ? 'bg-destructive-subtle text-destructive-text'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {humanize(snap.priority)} priority
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
                {humanize(snap.type)}
              </span>
              {dataRow && (
                <span className="rounded-md bg-primary-subtle px-2 py-0.5 text-primary">
                  Data row {(d.dataRowIndex ?? 0) + 1}:{' '}
                  {Object.entries(dataRow)
                    .map(([k, v]) => `${k} = ${v}`)
                    .join(', ')}
                </span>
              )}
              {d.status !== 'UNTESTED' && (
                <span className={cn('rounded-md px-2 py-0.5', RESULT_META[d.status].pill)}>
                  Result: {RESULT_META[d.status].label}
                </span>
              )}
            </div>
          </div>

          {snap.preconditions && (
            <section className="rounded-lg bg-muted px-4 py-2.5">
              <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Preconditions
              </h3>
              <p className="mt-0.5 text-sm whitespace-pre-wrap">{snap.preconditions}</p>
            </section>
          )}

          <section className="overflow-hidden rounded-xl border bg-card" aria-label="Steps">
            <div className="flex gap-3 bg-background px-4 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <span className="w-6">Step</span>
              <span className="flex-1">Action and expected result</span>
              <span>Result</span>
            </div>
            {snap.steps.length === 0 && (
              <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground">
                This case has no steps. Record the overall result below.
              </p>
            )}
            {snap.steps.map((s, i) => {
              const st = stepStatus(i);
              const failed = st?.status === 'FAILED';
              return (
                <div
                  key={i}
                  className={cn('flex gap-3 border-t px-4 py-3', failed && 'bg-destructive-subtle')}
                >
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                      failed
                        ? 'bg-destructive text-white'
                        : st?.status === 'PASSED'
                          ? 'bg-success-subtle text-success-text'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="grid min-w-0 flex-1 gap-1">
                    <p className="text-sm font-medium whitespace-pre-wrap">{s.action}</p>
                    {s.expected && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-semibold">Expected</span> {s.expected}
                      </p>
                    )}
                    {failed && (
                      <div className="mt-1 grid gap-2">
                        <label className="grid gap-1 rounded-lg border border-destructive bg-card px-2.5 py-2">
                          <span className="text-[11px] font-semibold text-destructive-text">
                            Actual result
                          </span>
                          <Textarea
                            rows={2}
                            className="min-h-0 resize-none border-0 p-0 shadow-none focus-visible:ring-0"
                            value={st.actual}
                            disabled={readOnly}
                            onChange={(e) => setActual(i, e.target.value)}
                            onBlur={() => void save(undefined, { stepResults: steps })}
                            placeholder="What actually happened?"
                          />
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => reportFrom(i)}>
                            <Bug /> Report bug from this step
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            Steps, evidence and environment are copied into the bug.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div
                    className="flex h-fit gap-0.5 rounded-lg bg-muted p-0.5"
                    role="group"
                    aria-label={`Result for step ${i + 1}`}
                  >
                    {RESULT_KEYS.map(([status, , Icon]) => {
                      const on = st?.status === status;
                      return (
                        <button
                          key={status}
                          type="button"
                          disabled={readOnly}
                          aria-pressed={on}
                          aria-label={`Step ${i + 1}: ${RESULT_META[status].label}`}
                          onClick={() => setStep(i, status)}
                          className={cn(
                            'flex h-[26px] w-7 items-center justify-center rounded-md disabled:opacity-60',
                            on ? RESULT_META[status].solid : 'text-muted-foreground hover:bg-card',
                          )}
                        >
                          <Icon className="size-3.5" aria-hidden />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>

          {d.bugs.length > 0 && (
            <section className="grid gap-1.5" aria-label="Bugs from this result">
              <h3 className="text-sm font-semibold">Bugs</h3>
              {d.bugs.map((b) => (
                <Link
                  key={b.id}
                  href={`${base}/bugs/${b.ref}`}
                  className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:bg-accent"
                >
                  <Bug className="size-4 text-destructive" aria-hidden />
                  <span className="font-mono text-xs text-muted-foreground">{b.ref}</span>
                  <span className="truncate font-medium">{b.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {humanize(b.status)}
                  </span>
                </Link>
              ))}
            </section>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <section className="grid content-start gap-2" aria-label="Evidence">
              <h3 className="text-sm font-semibold">Evidence</h3>
              <div className="flex flex-wrap gap-2.5">
                {d.attachments.map((a) => (
                  <a
                    key={a.id}
                    href={`/v1/projects/${projectId}/attachments/${a.id}/download`}
                    target="_blank"
                    rel="noreferrer"
                    className="grid w-40 gap-1 rounded-lg border bg-card p-1.5 text-[11px] text-muted-foreground hover:border-primary"
                  >
                    {a.contentType.startsWith('image/') &&
                    a.scanStatus !== 'PENDING' &&
                    a.scanStatus !== 'INFECTED' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/v1/projects/${projectId}/attachments/${a.id}/download`}
                        alt={a.fileName}
                        className="h-22 w-full rounded object-cover object-top"
                      />
                    ) : (
                      <span className="flex h-22 items-center justify-center rounded bg-muted">
                        {a.scanStatus === 'PENDING'
                          ? 'Scanning…'
                          : a.scanStatus === 'INFECTED'
                            ? 'Blocked by scan'
                            : a.fileName.split('.').pop()?.toUpperCase()}
                      </span>
                    )}
                    <span className="truncate">{a.fileName}</span>
                  </a>
                ))}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void addFiles([...e.dataTransfer.files]);
                    }}
                    className="flex min-h-28 min-w-40 flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-3 text-center hover:border-primary hover:bg-accent/50"
                  >
                    {upload.isPending ? (
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    ) : (
                      <Camera className="size-5 text-muted-foreground" aria-hidden />
                    )}
                    <span className="text-xs font-medium">Drop screenshots or click to add</span>
                    <span className="text-[11px] text-muted-foreground">
                      or paste with <Kbd>Ctrl V</Kbd>
                    </span>
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  multiple
                  accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,application/pdf,text/plain"
                  onChange={(e) => {
                    void addFiles([...(e.target.files ?? [])]);
                    e.target.value = '';
                  }}
                />
              </div>
            </section>
            <section className="grid content-start gap-2">
              <label htmlFor="result-notes" className="text-sm font-semibold">
                Notes
              </label>
              <Textarea
                id="result-notes"
                rows={4}
                value={notes}
                disabled={readOnly}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => notes !== (d.notes ?? '') && void save(undefined, { notes })}
                placeholder="Anything the next tester or the developer should know"
              />
            </section>
          </div>
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t bg-card px-7 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
        {closed ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="size-4" aria-hidden /> This run is closed. Reopen it to record results.
          </p>
        ) : readOnly ? (
          <p className="text-sm text-muted-foreground">
            Your role can view this run but not record results.
          </p>
        ) : (
          <>
            <span
              className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 font-mono text-sm font-semibold"
              aria-label={`Time on this case ${mmss}`}
            >
              <Clock className="size-3.5 text-muted-foreground" aria-hidden /> {mmss}
            </span>
            <div className="flex-1" />
            {failedIdx === undefined && d.status === 'FAILED' && (
              <Button variant="outline" onClick={() => reportFrom()}>
                <Bug /> Report bug
              </Button>
            )}
            {RESULT_KEYS.map(([status, key, Icon]) => (
              <button
                key={status}
                type="button"
                onClick={() => save(status)}
                disabled={record.isPending}
                aria-keyshortcuts={key.toUpperCase()}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-60',
                  BTN[status],
                  d.status === status && 'ring-2 ring-ring/50 ring-offset-1',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {status === 'PASSED'
                  ? 'Pass'
                  : status === 'FAILED'
                    ? 'Fail'
                    : RESULT_META[status].label.replace('ped', '')}
                <Kbd className="bg-card/90 text-muted-foreground">{key.toUpperCase()}</Kbd>
              </button>
            ))}
            <Button onClick={goNextUntested}>
              Next untested <ChevronRight />
            </Button>
          </>
        )}
      </footer>
      {bugOpen && (
        <BugFormDialog
          open
          onOpenChange={(o) => !o && setBugOpen(null)}
          projectId={projectId}
          basePath={base}
          initial={bugOpen}
          onCreated={refetch}
        />
      )}
    </>
  );
}
