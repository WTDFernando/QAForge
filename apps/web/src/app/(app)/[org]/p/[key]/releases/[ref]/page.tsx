'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  BarChart3,
  Check,
  CircleAlert,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Rocket,
  ShieldCheck,
  X,
} from 'lucide-react';
import { GATE_METRIC_INFO, type GateResult } from '@qaforge/shared';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { Topbar } from '@/components/shell/topbar';
import { useAiAvailability } from '@/components/ai/ai-button';
import { BAND, formatDate, ReadinessBadge, ReleaseStatusBadge } from '@/components/releases/parts';
import {
  ApproversDialog,
  DecisionDialog,
  GatesDialog,
  ScopeDialog,
} from '@/components/releases/release-dialogs';
import {
  useCreateReport,
  useDeleteRelease,
  useMarkReleased,
  useRelease,
  useReleaseScope,
  useReopenRelease,
  useReports,
  useRequestApproval,
  type ReleaseDetail,
} from '@/hooks/releases';
import { useCurrentProject, useMe } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';

const EDITABLE = new Set(['DRAFT', 'REJECTED']);
const OP = { GTE: '≥', LTE: '≤', EQ: '=' } as const;

export default function ReleasePage() {
  const { ref, org: orgSlug, key } = useParams<{ ref: string; org: string; key: string }>();
  const { project } = useCurrentProject();
  const pid = project?.id;
  const release = useRelease(pid, ref);
  const r = release.data;

  return (
    <div className="pb-10">
      <Topbar>
        <div className="truncate text-sm text-muted-foreground">
          <Link href={`/${orgSlug}/p/${key}/releases`} className="hover:underline">
            Releases
          </Link>{' '}
          <span aria-hidden>›</span>{' '}
          <span className="font-medium text-foreground">{r ? r.ref : ref}</span>
        </div>
      </Topbar>
      {release.isError ? (
        <ErrorState error={release.error} retry={() => release.refetch()} what={`release ${ref}`} />
      ) : !r || !pid ? (
        <div className="grid gap-4 p-6 lg:px-8">
          <Skeleton className="h-10 w-80" />
          <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
          </div>
        </div>
      ) : (
        <ReleaseView projectId={pid} r={r} base={`/${orgSlug}/p/${key}`} />
      )}
    </div>
  );
}

function ReleaseView({
  projectId,
  r,
  base,
}: {
  projectId: string;
  r: ReleaseDetail;
  base: string;
}) {
  const me = useMe();
  const router = useRouter();
  const canWrite = useCan('release:write');
  const canSign = useCan('release:sign');
  const canReport = useCan('report:write');
  const ai = useAiAvailability('report');
  const [dialog, setDialog] = useState<
    | { kind: 'gates' }
    | { kind: 'approvers' }
    | { kind: 'scope'; scope: 'requirements' | 'testRuns' | 'bugs' }
    | { kind: 'decision'; decision: 'APPROVED' | 'REJECTED' }
    | null
  >(null);
  const request = useRequestApproval(projectId, r.id);
  const reopen = useReopenRelease(projectId, r.id);
  const ship = useMarkReleased(projectId, r.id);
  const del = useDeleteRelease(projectId);
  const report = useCreateReport(projectId);
  const editable = EDITABLE.has(r.status);
  const mine = r.approvals.find((a) => a.approver.id === me.data?.user.id);
  const blockingFailing = r.gates.filter((g) => g.blocking && !g.passed);
  const requestBlocker = !r.approvals.length
    ? 'Add at least one approver first'
    : blockingFailing.length
      ? `${blockingFailing.length} blocking gate${blockingFailing.length === 1 ? '' : 's'} not met`
      : null;
  const openBugs = r.bugs.filter((b) => !['CLOSED'].includes(b.status));

  const goNoGo = () =>
    report.mutate(
      { type: 'GO_NO_GO', params: { releaseId: r.id }, narrative: ai.ok },
      { onSuccess: (x) => router.push(`${base}/reports/${x.id}`) },
    );

  return (
    <div className="grid gap-5 px-6 pt-6 lg:px-8">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-sm text-muted-foreground">{r.ref}</span>
            <h1 className="text-xl font-bold tracking-tight">
              {r.name} <span className="font-semibold text-muted-foreground">{r.version}</span>
            </h1>
            <ReleaseStatusBadge status={r.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Target {formatDate(r.targetDate)} · {r.requirements.length} requirements ·{' '}
            {r.testRuns.length} test run
            {r.testRuns.length === 1 ? '' : 's'} · {openBugs.length} open bug
            {openBugs.length === 1 ? '' : 's'}
            {r.releasedAt && ` · released ${formatDate(r.releasedAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canReport && (
            <Button variant="outline" onClick={goNoGo} disabled={report.isPending}>
              <BarChart3 /> Go / No-Go report
            </Button>
          )}
          {mine?.status === 'PENDING' && r.status === 'PENDING_APPROVAL' && (
            <>
              <Button
                variant="outline"
                onClick={() => setDialog({ kind: 'decision', decision: 'REJECTED' })}
              >
                <X /> Reject
              </Button>
              <Button onClick={() => setDialog({ kind: 'decision', decision: 'APPROVED' })}>
                <Check /> Approve
              </Button>
            </>
          )}
          {canSign && editable && (
            <Button
              onClick={() => request.mutate(undefined)}
              disabled={!!requestBlocker || request.isPending}
              title={requestBlocker ?? undefined}
              aria-describedby={requestBlocker ? 'request-blocker' : undefined}
            >
              <ShieldCheck /> Request approval
            </Button>
          )}
          {canSign && r.status === 'APPROVED' && (
            <Button
              onClick={() =>
                confirm(`Mark ${r.name} ${r.version} as released?`) && ship.mutate(undefined)
              }
              disabled={ship.isPending}
            >
              <Rocket /> Mark as released
            </Button>
          )}
          {(canSign || canWrite) && r.status !== 'RELEASED' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Release actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canSign && !editable && (
                  <DropdownMenuItem onSelect={() => reopen.mutate(undefined)}>
                    <RotateCcw /> Back to draft
                  </DropdownMenuItem>
                )}
                {canWrite && (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      if (confirm(`Delete ${r.ref} ${r.name}? Its test runs stay.`))
                        del.mutate(r.id, { onSuccess: () => router.push(`${base}/releases`) });
                    }}
                  >
                    Delete release
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {canSign && editable && requestBlocker && (
        <p
          id="request-blocker"
          className="-mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <CircleAlert className="size-3.5" aria-hidden /> Approval can be requested when:{' '}
          {requestBlocker.toLowerCase()}.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <ReadinessCard r={r} />
        <GatesCard
          r={r}
          onEdit={canWrite && editable ? () => setDialog({ kind: 'gates' }) : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <ScopeCard
          r={r}
          projectId={projectId}
          base={base}
          editable={canWrite && editable}
          onAdd={(scope) => setDialog({ kind: 'scope', scope })}
        />
        <div className="grid content-start gap-4">
          <SignOffCard
            r={r}
            onEdit={canSign && editable ? () => setDialog({ kind: 'approvers' }) : undefined}
          />
          <ReleaseReports projectId={projectId} releaseId={r.id} base={base} />
        </div>
      </div>

      {dialog?.kind === 'gates' && (
        <GatesDialog projectId={projectId} release={r} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'approvers' && (
        <ApproversDialog projectId={projectId} release={r} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'scope' && (
        <ScopeDialog
          projectId={projectId}
          release={r}
          kind={dialog.scope}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'decision' && (
        <DecisionDialog
          projectId={projectId}
          release={r}
          decision={dialog.decision}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function ReadinessCard({ r }: { r: ReleaseDetail }) {
  const b = BAND[r.readiness.band];
  const LABEL: Record<string, string> = {
    passRate: 'Pass rate',
    executionComplete: 'Execution',
    requirementCoverage: 'Requirement coverage',
    bugs: 'Open bugs',
  };
  return (
    <section aria-labelledby="readiness-h" className="rounded-xl border bg-card p-5">
      <h2 id="readiness-h" className="text-xs font-semibold text-muted-foreground">
        Readiness
      </h2>
      <div className="mt-1 flex items-end gap-2">
        <span className={cn('text-5xl font-bold tabular-nums', b.text)}>{r.readiness.score}</span>
        <span className="pb-2 text-muted-foreground">/100</span>
        <span className="ml-auto pb-2">
          <ReadinessBadge band={r.readiness.band} blockingFailed={r.readiness.blockingFailed} />
        </span>
      </div>
      <ul className="mt-4 grid gap-3">
        {r.readiness.parts.map((p) => {
          const v = Math.round(p.value);
          return (
            <li key={p.key} className="grid gap-1">
              <div className="flex text-sm">
                <span className="flex-1">{LABEL[p.key]}</span>
                <span className="text-xs text-muted-foreground">
                  {v} · weight {Math.round(p.weight * 100)}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className={cn(
                    'h-full rounded-full',
                    v >= 90 ? 'bg-success' : v >= 70 ? 'bg-warning' : 'bg-destructive',
                  )}
                  style={{ width: `${v}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function gateLabel(g: GateResult) {
  return (
    GATE_METRIC_INFO[g.metric].label +
    (g.metric === 'OPEN_BUGS' && g.params.severities?.length
      ? ` (${g.params.severities.map((s) => s.toLowerCase()).join(', ')})`
      : '')
  );
}

function GatesCard({ r, onEdit }: { r: ReleaseDetail; onEdit?: () => void }) {
  const met = r.gates.filter((g) => g.passed).length;
  return (
    <section aria-labelledby="gates-h" className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <h2 id="gates-h" className="flex-1 text-sm font-semibold">
          Quality gates
        </h2>
        <span className="text-xs text-muted-foreground">
          {met} of {r.gates.length} met
        </span>
        {onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil /> Edit
          </Button>
        )}
      </div>
      {r.gates.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          No quality gates. The release can be approved on judgement alone.
        </p>
      ) : (
        <ul>
          {r.gates.map((g) => {
            const unit = GATE_METRIC_INFO[g.metric].unit === '%' ? '%' : '';
            return (
              <li
                key={g.id}
                className={cn(
                  'flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0',
                  !g.passed && g.blocking && 'bg-destructive-subtle/60',
                )}
              >
                {g.passed ? (
                  <Check className="size-4 text-success-text" aria-label="Met" />
                ) : (
                  <X
                    className={cn(
                      'size-4',
                      g.blocking ? 'text-destructive-text' : 'text-warning-text',
                    )}
                    aria-label="Not met"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{gateLabel(g)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {GATE_METRIC_INFO[g.metric].description}
                  </span>
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {OP[g.operator]} {g.threshold}
                  {unit}
                </span>
                <span
                  className={cn(
                    'w-16 text-right font-mono text-sm font-semibold',
                    g.passed
                      ? 'text-success-text'
                      : g.blocking
                        ? 'text-destructive-text'
                        : 'text-warning-text',
                  )}
                >
                  {g.actual === null ? '—' : `${g.actual}${unit}`}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  {g.blocking ? 'Blocking' : 'Advisory'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ScopeCard({
  r,
  projectId,
  base,
  editable,
  onAdd,
}: {
  r: ReleaseDetail;
  projectId: string;
  base: string;
  editable: boolean;
  onAdd: (k: 'requirements' | 'testRuns' | 'bugs') => void;
}) {
  const [tab, setTab] = useState<'requirements' | 'testRuns' | 'bugs'>('requirements');
  const scope = useReleaseScope(projectId, r.id);
  const counts = {
    requirements: r.requirements.length,
    testRuns: r.testRuns.length,
    bugs: r.bugs.length,
  };
  const LABEL = { requirements: 'Requirements', testRuns: 'Test runs', bugs: 'Bugs' } as const;
  const remove = (kind: 'requirementIds' | 'testRunIds' | 'bugIds', id: string) =>
    scope.mutate({ remove: { requirementIds: [], testRunIds: [], bugIds: [], [kind]: [id] } });
  const SEV: Record<string, string> = {
    BLOCKER: 'bg-destructive-subtle text-destructive-text',
    CRITICAL: 'bg-destructive-subtle text-destructive-text',
    MAJOR: 'bg-warning-subtle text-warning-text',
  };
  return (
    <section aria-label="Scope" className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-4 border-b px-4">
        <div role="tablist" aria-label="Scope" className="flex gap-5">
          {(Object.keys(LABEL) as (keyof typeof LABEL)[]).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                '-mb-px flex items-center gap-1.5 border-b-2 py-3 text-sm',
                tab === k
                  ? 'border-primary font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {LABEL[k]}
              <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
                {counts[k]}
              </span>
            </button>
          ))}
        </div>
        {editable && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onAdd(tab)}>
            <Plus /> Add {LABEL[tab].toLowerCase()}
          </Button>
        )}
      </div>
      <div role="tabpanel" aria-label={LABEL[tab]}>
        <ul>
          {tab === 'requirements' &&
            (r.requirements.length ? (
              r.requirements.map((q) => (
                <li
                  key={q.id}
                  className="flex items-center gap-3 border-b px-4 py-2.5 text-sm last:border-b-0"
                >
                  <span className="font-mono text-xs text-muted-foreground">{q.ref}</span>
                  <Link
                    href={`${base}/requirements/${q.id}`}
                    className="min-w-0 flex-1 truncate hover:underline"
                  >
                    {q.title}
                  </Link>
                  <span className="text-xs text-muted-foreground capitalize">
                    {q.priority.toLowerCase()}
                  </span>
                  <span
                    className={cn(
                      'text-xs',
                      q._count.testCases
                        ? 'text-muted-foreground'
                        : 'font-semibold text-destructive-text',
                    )}
                  >
                    {q._count.testCases} test{q._count.testCases === 1 ? '' : 's'}
                  </span>
                  {editable && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7"
                      aria-label={`Remove ${q.ref}`}
                      onClick={() => remove('requirementIds', q.id)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))
            ) : (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                No requirements yet. Add the ones this release delivers.
              </li>
            ))}
          {tab === 'testRuns' &&
            (r.testRuns.length ? (
              r.testRuns.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-3 border-b px-4 py-2.5 text-sm last:border-b-0"
                >
                  <span className="font-mono text-xs text-muted-foreground">{t.ref}</span>
                  <Link
                    href={`${base}/runs/${t.ref}`}
                    className="min-w-0 flex-1 truncate hover:underline"
                  >
                    {t.name}
                  </Link>
                  {t.source === 'AUTOMATION' && (
                    <span className="rounded bg-muted px-1.5 text-[11px]">Automated</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {t.environment?.name ?? 'No environment'}
                  </span>
                  <span className="text-xs text-muted-foreground">{t._count.results} cases</span>
                  {editable && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7"
                      aria-label={`Remove ${t.ref}`}
                      onClick={() => remove('testRunIds', t.id)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))
            ) : (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                No test runs yet. Their results feed the quality gates.
              </li>
            ))}
          {tab === 'bugs' &&
            (r.bugs.length ? (
              r.bugs.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center gap-3 border-b px-4 py-2.5 text-sm last:border-b-0"
                >
                  <span className="font-mono text-xs text-muted-foreground">{b.ref}</span>
                  <Link
                    href={`${base}/bugs/${b.ref}`}
                    className="min-w-0 flex-1 truncate hover:underline"
                  >
                    {b.title}
                  </Link>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-semibold capitalize',
                      SEV[b.severity] ?? 'bg-muted text-muted-foreground',
                    )}
                  >
                    {b.severity.toLowerCase()}
                  </span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {b.status.toLowerCase().replace(/_/g, ' ')}
                  </span>
                  <span className="w-20 text-right text-[11px] text-muted-foreground">
                    {b.inScope ? 'In scope' : 'Found in a run'}
                  </span>
                  {editable && b.inScope && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7"
                      aria-label={`Remove ${b.ref}`}
                      onClick={() => remove('bugIds', b.id)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))
            ) : (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                No bugs linked to this release.
              </li>
            ))}
        </ul>
      </div>
    </section>
  );
}

function SignOffCard({ r, onEdit }: { r: ReleaseDetail; onEdit?: () => void }) {
  const STATUS = {
    PENDING: ['Pending', 'bg-muted text-muted-foreground'],
    APPROVED: ['Approved', 'bg-success-subtle text-success-text'],
    REJECTED: ['Rejected', 'bg-destructive-subtle text-destructive-text'],
  } as const;
  return (
    <section aria-labelledby="signoff-h" className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <h2 id="signoff-h" className="flex-1 text-sm font-semibold">
          Sign-off
        </h2>
        {onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Plus /> Approvers
          </Button>
        )}
      </div>
      {r.approvals.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No approvers yet. Name the people who must sign off (QA Lead, product owner, client).
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {r.approvals.map((a) => {
            const [label, cls] = STATUS[a.status];
            return (
              <li key={a.id} className="rounded-lg border p-2.5">
                <div className="flex items-center gap-2.5">
                  <Avatar name={a.approver.name} src={a.approver.image} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{a.approver.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {a.roleLabel}
                      {a.decidedAt && ` · ${formatDate(a.decidedAt)}`}
                    </span>
                  </span>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', cls)}>
                    {label}
                  </span>
                </div>
                {a.comment && (
                  <p className="mt-2 rounded bg-muted/60 px-2 py-1.5 text-xs">“{a.comment}”</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {r.status === 'PENDING_APPROVAL' && r.requestedAt && (
        <p className="mt-3 text-xs text-muted-foreground">
          Gates were frozen when approval was requested on {formatDate(r.requestedAt)}.
        </p>
      )}
    </section>
  );
}

function ReleaseReports({
  projectId,
  releaseId,
  base,
}: {
  projectId: string;
  releaseId: string;
  base: string;
}) {
  const reports = useReports(projectId);
  const mine = (reports.data ?? []).filter((x) => x.release?.id === releaseId).slice(0, 5);
  if (!mine.length) return null;
  return (
    <section aria-labelledby="rel-reports-h" className="rounded-xl border bg-card p-4">
      <h2 id="rel-reports-h" className="text-sm font-semibold">
        Reports
      </h2>
      <ul className="mt-2 grid gap-1">
        {mine.map((x) => (
          <li key={x.id}>
            <Link
              href={`${base}/reports/${x.id}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <BarChart3 className="size-4 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{x.title}</span>
              <span className="text-xs text-muted-foreground">{formatDate(x.createdAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
