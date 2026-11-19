'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Bug,
  Check,
  Download,
  FileArchive,
  Loader2,
  Play,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { BugFormDialog, type BugFormInitial } from '@/components/bugs/bug-form-dialog';
import { useAiAvailability } from '@/components/ai/ai-button';
import { describeAssertion } from '@/components/automation/request-parts';
import { describeSelection } from '@/components/automation/selection';
import {
  AutomationHeader,
  FailureClassBadge,
  MethodTag,
  ResultBadge,
  RunStatusBadge,
  formatMs,
  useAutomationBase,
} from '@/components/automation/shell';
import { useLatestJob, useStartAgentJob } from '@/hooks/ai';
import {
  fetchBugDraft,
  useAutomationResult,
  useAutomationRun,
  useCancelRun,
  useStartRun,
  type AutomationResultFull,
  type AutomationResultRow,
  type AutomationRunFull,
} from '@/hooks/automation';
import { useCurrentProject } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';
import type { AttachmentRow } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';

export default function AutomationRunPage() {
  const { ref } = useParams<{ ref: string }>();
  const { project, org } = useCurrentProject();
  const pid = project?.id;
  const run = useAutomationRun(pid, ref);
  const base = useAutomationBase();
  const canRun = useCan('automation:run');
  const cancel = useCancelRun(pid ?? '');
  const start = useStartRun(pid ?? '');
  const router = useRouter();
  const [picked, setPicked] = useState<string | null>(null);
  const r = run.data;
  // Failures first by default: that's what people open a run for.
  const firstFailed = r?.results.find((x) => x.status === 'FAILED') ?? r?.results[0];
  const selectedId = picked ?? firstFailed?.id ?? null;
  const selected = r?.results.find((x) => x.id === selectedId) ?? null;
  const live = r?.status === 'QUEUED' || r?.status === 'RUNNING';

  return (
    <div className="flex h-dvh flex-col">
      <AutomationHeader />
      {run.isError ? (
        <ErrorState error={run.error} retry={() => run.refetch()} what={`run ${ref}`} />
      ) : !r || !pid ? (
        <div className="grid gap-3 p-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 border-b px-6 py-4 lg:px-8">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight">{r.ref}</h1>
                <RunStatusBadge status={r.status} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {describeSelection(r.selection)}
                {r.environment && ` · ${r.environment.name}`}
                {r.build && ` · build ${r.build}`}
                {` · ${r.trigger === 'CI_WEBHOOK' ? 'from CI' : r.schedule ? `schedule “${r.schedule.name}”` : 'started manually'}`}
                {` · ${timeAgo(r.createdAt)}`}
                {r.totals && ` · ${formatMs(r.totals.durationMs)}`}
              </p>
            </div>
            {r.testRun && org && project && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/${org.slug}/p/${project.key}/runs/${r.testRun.ref}`}>
                  Open {r.testRun.ref}
                </Link>
              </Button>
            )}
            {canRun && live && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => cancel.mutate(r.id)}
                disabled={cancel.isPending}
              >
                <Square /> Cancel
              </Button>
            )}
            {canRun && !live && (
              <Button
                size="sm"
                variant="outline"
                disabled={start.isPending}
                onClick={() =>
                  start.mutate(
                    {
                      selection: r.selection,
                      environmentId: r.environment?.id ?? null,
                      build: r.build,
                      retries: r.retries,
                    },
                    { onSuccess: (n) => router.push(`${base}/runs/${n.ref}`) },
                  )
                }
              >
                <Play /> Run again
              </Button>
            )}
          </div>
          {r.error && (
            <p
              role="alert"
              className="mx-6 mt-4 rounded-lg bg-destructive-subtle p-3 font-mono text-xs whitespace-pre-wrap text-destructive-text lg:mx-8"
            >
              {r.error}
            </p>
          )}
          {r.results.length === 0 ? (
            live ? (
              <EmptyState
                icon={Loader2}
                title={r.status === 'QUEUED' ? 'Waiting for a worker' : 'Running'}
                description="Results appear here as soon as the run finishes. This page refreshes on its own."
              />
            ) : (
              <EmptyState
                icon={Play}
                title="Nothing ran"
                description="The selection had no enabled tests or requests."
              />
            )
          ) : (
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <ResultList run={r} selectedId={selectedId} onSelect={setPicked} />
              <main className="min-h-0 min-w-0 flex-1 overflow-auto p-4 lg:p-6">
                {selected && (
                  <ResultDetail key={selected.id} projectId={pid} run={r} row={selected} />
                )}
              </main>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ResultList({
  run,
  selectedId,
  onSelect,
}: {
  run: AutomationRunFull;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = run.totals;
  return (
    <aside
      aria-label="Results"
      className="flex max-h-72 shrink-0 flex-col border-b bg-card md:max-h-none md:w-96 md:border-r md:border-b-0"
    >
      {t && (
        <div className="grid grid-cols-4 gap-2 border-b p-3 text-center">
          {(
            [
              ['Passed', t.passed, 'text-success-text'],
              ['Failed', t.failed, 'text-destructive-text'],
              ['Flaky', t.flaky, 'text-warning-text'],
              ['Skipped', t.skipped, 'text-muted-foreground'],
            ] as const
          ).map(([l, n, c]) => (
            <div key={l}>
              <div className={cn('text-lg font-bold tabular-nums', c)}>{n}</div>
              <div className="text-[11px] text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>
      )}
      <ul className="min-h-0 flex-1 overflow-auto p-2">
        {run.results.map((x) => (
          <li key={x.id}>
            <button
              onClick={() => onSelect(x.id)}
              aria-current={selectedId === x.id ? 'true' : undefined}
              className={cn(
                'grid w-full gap-1 rounded-md px-2.5 py-2 text-left',
                selectedId === x.id ? 'bg-accent' : 'hover:bg-accent/60',
              )}
            >
              <span className="flex items-center gap-2">
                {x.status === 'PASSED' ? (
                  <Check className="size-4 shrink-0 text-success-text" aria-label="Passed" />
                ) : x.status === 'FAILED' ? (
                  <X className="size-4 shrink-0 text-destructive-text" aria-label="Failed" />
                ) : (
                  <span
                    className="size-4 shrink-0 text-center text-xs text-muted-foreground"
                    aria-label={x.status}
                  >
                    –
                  </span>
                )}
                {x.apiRequest && <MethodTag method={x.apiRequest.method} className="w-auto" />}
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-[13px]',
                    x.automationTest && 'font-mono text-[12px]',
                  )}
                >
                  {x.automationTest?.path ?? x.name}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {formatMs(x.durationMs)}
                </span>
              </span>
              {(x.flaky || x.failureClass || x.automationTest?.status === 'QUARANTINED') && (
                <span className="flex flex-wrap gap-1 pl-6">
                  {x.failureClass && <FailureClassBadge value={x.failureClass} />}
                  {x.flaky && (
                    <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-xs font-semibold text-warning-text">
                      Flaky
                    </span>
                  )}
                  {x.automationTest?.status === 'QUARANTINED' && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                      Quarantined
                    </span>
                  )}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function ResultDetail({
  projectId,
  run,
  row,
}: {
  projectId: string;
  run: AutomationRunFull;
  row: AutomationResultRow;
}) {
  const detail = useAutomationResult(projectId, row.id);
  const base = useAutomationBase();
  const canBug = useCan('bug:write');
  const canWrite = useCan('automation:write');
  const { project, org } = useCurrentProject();
  const [bug, setBug] = useState<BugFormInitial | null>(null);
  const [loadingBug, setLoadingBug] = useState(false);
  const failed = row.status === 'FAILED';

  async function reportBug() {
    setLoadingBug(true);
    try {
      const d = await fetchBugDraft(projectId, row.id);
      setBug({
        title: d.title,
        stepsToReproduce: d.stepsToReproduce,
        expectedResult: d.expectedResult,
        actualResult: d.actualResult,
        severity: d.severity,
        priority: d.priority,
        extra: { environmentId: d.environmentId, testRunResultId: d.testRunResultId },
        context: `From ${run.ref}`,
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingBug(false);
    }
  }

  return (
    <div className="grid max-w-5xl gap-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2
            className={cn(
              'truncate text-base font-semibold',
              row.automationTest && 'font-mono text-[14px]',
            )}
          >
            {row.automationTest?.path ?? row.name}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <ResultBadge status={row.status} flaky={row.flaky} />
            <span>{formatMs(row.durationMs)}</span>
            {row.attempts > 1 && <span>· {row.attempts} attempts</span>}
            {row.runResult && run.testRun && <span>· recorded in {run.testRun.ref}</span>}
          </div>
        </div>
        {row.automationTest && (
          <Button asChild variant="ghost" size="sm">
            <Link href={`${base}/tests`}>Open test</Link>
          </Button>
        )}
        {failed && canBug && (
          <Button size="sm" variant="outline" onClick={reportBug} disabled={loadingBug}>
            <Bug /> Report bug
          </Button>
        )}
      </div>

      {row.error && (
        <pre className="max-h-60 overflow-auto rounded-lg bg-destructive-subtle p-3 font-mono text-xs whitespace-pre-wrap text-destructive-text">
          {row.error}
        </pre>
      )}

      {failed && <AnalysisCard projectId={projectId} row={row} canWrite={canWrite} />}

      {detail.isError ? (
        <ErrorState error={detail.error} retry={() => detail.refetch()} what="this result" />
      ) : !detail.data ? (
        <Skeleton className="h-40" />
      ) : (
        <Evidence projectId={projectId} result={detail.data} />
      )}

      {bug && project && org && (
        <BugFormDialog
          open
          onOpenChange={(o) => !o && setBug(null)}
          projectId={projectId}
          basePath={`/${org.slug}/p/${project.key}`}
          initial={bug}
          onCreated={(ref) => toast.success(`${ref} reported`)}
        />
      )}
    </div>
  );
}

/** Failure Analysis Agent output + the repair agent entry point. */
function AnalysisCard({
  projectId,
  row,
  canWrite,
}: {
  projectId: string;
  row: AutomationResultRow;
  canWrite: boolean;
}) {
  const start = useStartAgentJob(projectId);
  const analysisAi = useAiAvailability('failure-analysis');
  const repairAi = useAiAvailability('automation');
  const analyzeJob = useLatestJob(projectId, row.id, 'analyze-failure');
  const repairJob = useLatestJob(projectId, row.id, 'repair-ui-test');
  const busy = (j?: { status: string }) => j?.status === 'QUEUED' || j?.status === 'RUNNING';
  const a = row.analysis;
  const canRepair =
    !!row.automationTest &&
    canWrite &&
    repairAi.ok &&
    (!a || row.failureClass === 'TEST_BUG' || a.locatorIssue);

  const repairButton = canRepair && (
    <Button
      size="sm"
      variant={a?.locatorIssue || row.failureClass === 'TEST_BUG' ? 'default' : 'outline'}
      disabled={busy(repairJob) || start.isPending}
      onClick={() =>
        start.mutate(
          { kind: 'repair-ui-test', automationResultId: row.id },
          {
            onSuccess: () =>
              toast.success('Looking for a fix. It will appear on the test for your approval.'),
          },
        )
      }
    >
      {busy(repairJob) ? <Loader2 className="animate-spin" /> : <Sparkles />} Suggest a fix
    </Button>
  );

  if (!a)
    return (
      <section
        aria-label="AI analysis"
        className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-4"
      >
        <Sparkles className="size-4 text-primary" aria-hidden />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {busy(analyzeJob)
            ? (analyzeJob?.progressMessage ?? 'Analyzing the failure…')
            : analysisAi.ok
              ? 'Ask the Failure Analysis Agent whether this is a product bug, a test problem, flakiness or the environment.'
              : analysisAi.reason}
        </p>
        {analysisAi.ok && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy(analyzeJob) || start.isPending}
            onClick={() => start.mutate({ kind: 'analyze-failure', automationResultId: row.id })}
          >
            {busy(analyzeJob) ? <Loader2 className="animate-spin" /> : <Sparkles />} Analyze
          </Button>
        )}
        {repairButton}
      </section>
    );
  return (
    <section aria-label="AI analysis" className="grid gap-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold">Failure analysis</h3>
        {row.failureClass && <FailureClassBadge value={row.failureClass} />}
        <span className="text-xs text-muted-foreground">confidence {a.confidence.toFixed(2)}</span>
        <span className="ml-auto">{repairButton}</span>
      </div>
      <p className="text-sm">{a.reasoning}</p>
      {a.evidence && (
        <blockquote className="border-l-2 pl-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {a.evidence}
        </blockquote>
      )}
      {a.suggestedAction && (
        <p className="text-sm">
          <span className="font-medium">Next step: </span>
          {a.suggestedAction}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        AI suggestion. Check the evidence before acting on it.
      </p>
    </section>
  );
}

function fileUrl(projectId: string, a: AttachmentRow) {
  return `/v1/projects/${projectId}/attachments/${a.id}/download`;
}

function Evidence({ projectId, result }: { projectId: string; result: AutomationResultFull }) {
  const shots = result.attachments.filter((a) => a.contentType.startsWith('image/'));
  const videos = result.attachments.filter((a) => a.contentType.startsWith('video/'));
  const others = result.attachments.filter((a) => !shots.includes(a) && !videos.includes(a));
  const ex = result.exchange;
  const api = ex && 'request' in ex ? ex : null;
  const ui = ex && 'cases' in ex ? ex : null;
  return (
    <>
      {(shots.length > 0 || videos.length > 0 || others.length > 0) && (
        <section aria-label="Evidence" className="grid gap-3">
          <h3 className="text-sm font-semibold">Evidence</h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {shots.map((a) => (
              <a
                key={a.id}
                href={fileUrl(projectId, a)}
                target="_blank"
                rel="noreferrer"
                className="overflow-hidden rounded-lg border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl(projectId, a)}
                  alt={`Screenshot ${a.fileName}`}
                  className="w-full"
                />
              </a>
            ))}
            {videos.map((a) => (
              <video
                key={a.id}
                controls
                preload="metadata"
                className="w-full rounded-lg border"
                aria-label={`Video ${a.fileName}`}
              >
                <source src={fileUrl(projectId, a)} type={a.contentType} />
              </video>
            ))}
          </div>
          {others.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {others.map((a) => (
                <li key={a.id}>
                  <a
                    href={fileUrl(projectId, a)}
                    className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
                    download
                  >
                    {a.fileName.endsWith('.zip') ? (
                      <FileArchive className="size-3.5" aria-hidden />
                    ) : (
                      <Download className="size-3.5" aria-hidden />
                    )}
                    {a.fileName}
                    {a.fileName.startsWith('trace') && (
                      <span className="text-muted-foreground">
                        · open with npx playwright show-trace
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {ui && ui.cases.length > 0 && (
        <section aria-label="Tests in this file" className="grid gap-1">
          <h3 className="text-sm font-semibold">Tests in this file</h3>
          <ul className="divide-y rounded-lg border">
            {ui.cases.map((c, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                {c.status === 'expected' || c.status === 'flaky' ? (
                  <Check className="size-4 text-success-text" aria-label="Passed" />
                ) : c.status === 'skipped' ? (
                  <span className="w-4 text-center text-muted-foreground" aria-label="Skipped">
                    –
                  </span>
                ) : (
                  <X className="size-4 text-destructive-text" aria-label="Failed" />
                )}
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                {c.status === 'flaky' && (
                  <span className="text-xs text-warning-text">passed on retry</span>
                )}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatMs(c.durationMs)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {api && (
        <section aria-label="Request and response" className="grid gap-2">
          <h3 className="text-sm font-semibold">Request</h3>
          <p className="rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs break-all">
            {api.request.method} {api.request.url}
          </p>
          {api.assertions && api.assertions.length > 0 && (
            <ul className="grid gap-1" aria-label="Assertions">
              {api.assertions.map((o, i) => (
                <li
                  key={i}
                  className={cn(
                    'flex gap-2 rounded-md px-2 py-1.5 text-xs',
                    !o.passed && 'bg-destructive-subtle',
                  )}
                >
                  {o.passed ? (
                    <Check className="size-3.5 text-success-text" aria-label="Passed" />
                  ) : (
                    <X className="size-3.5 text-destructive-text" aria-label="Failed" />
                  )}
                  <span className="font-medium">{describeAssertion(o.assertion)}</span>
                  {!o.passed && <span className="text-destructive-text">{o.message}</span>}
                </li>
              ))}
            </ul>
          )}
          {api.response && (
            <>
              <h3 className="text-sm font-semibold">
                Response · {api.response.status} {api.response.statusText}
              </h3>
              <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-all">
                {api.response.body || 'Empty body'}
              </pre>
            </>
          )}
        </section>
      )}
      {result.log && (
        <details className="rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Log</summary>
          <pre className="max-h-96 overflow-auto border-t bg-muted/40 p-3 font-mono text-[11.5px] whitespace-pre-wrap">
            {result.log}
          </pre>
        </details>
      )}
    </>
  );
}
