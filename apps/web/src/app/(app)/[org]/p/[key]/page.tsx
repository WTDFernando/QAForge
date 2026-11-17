'use client';
import Link from 'next/link';
import {
  ArrowRight,
  Bug,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  FileText,
  PlayCircle,
  Rocket,
} from 'lucide-react';
import { BUG_SEVERITIES, humanize, TEST_CASE_STATUSES } from '@qaforge/shared';
import { ResultGlyph, SeverityBadge } from '@/components/qa/run-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shell/page-header';
import { AiBadge, PriorityLabel, Ref, TestCaseStatusBadge } from '@/components/qa/status';
import { useCurrentProject } from '@/hooks/queries';
import { useDashboard } from '@/hooks/qa';
import { cn } from '@/lib/utils';

const STATUS_BAR: Record<string, string> = {
  DRAFT: 'bg-muted-foreground/40',
  IN_REVIEW: 'bg-warning',
  APPROVED: 'bg-success',
  DEPRECATED: 'bg-muted',
};

function Metric({
  title,
  icon: Icon,
  children,
  footer,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardDescription className="font-medium text-foreground">{title}</CardDescription>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
      {footer && <div className="border-t px-5 py-2.5 text-xs text-muted-foreground">{footer}</div>}
    </Card>
  );
}

function NotYet({ phase, what }: { phase: number; what: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold text-muted-foreground">—</div>
      <p className="mt-1 text-xs text-muted-foreground">
        {what} arrive{what.endsWith('s') ? '' : 's'} in Phase {phase}.
      </p>
    </div>
  );
}

export default function ProjectDashboardPage() {
  const { project, org, isLoading } = useCurrentProject();
  const dash = useDashboard(project?.id);
  const d = dash.data;
  const base = org && project ? `/${org.slug}/p/${project.key}` : '';

  if (isLoading || !org)
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-64" />
      </div>
    );
  if (!project)
    return <div className="m-auto text-sm text-muted-foreground">Project not found.</div>;

  const steps = [
    { done: true, label: 'Create the project', href: base },
    {
      done: (d?.requirements.total ?? 0) > 0,
      label: 'Add or upload requirements',
      href: `${base}/requirements`,
    },
    {
      done: (d?.testCases.total ?? 0) > 0,
      label: 'Write or generate test cases',
      href: `${base}/test-cases`,
    },
    { done: !!d?.lastRun, label: 'Run your first test run', href: `${base}/runs` },
  ];
  const onboarding = !!d && steps.filter((s) => s.done).length < 3;

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            {org.name} / <span className="text-foreground">{project.name}</span>
          </>
        }
        title="Dashboard"
        description={project.description}
      />
      <div className="grid gap-6 px-6 pb-10 lg:px-8">
        {onboarding && (
          <Card className="border-primary/30 bg-primary/[0.03]">
            <CardHeader>
              <CardTitle className="text-base">
                <h2>Get started with {project.name}</h2>
              </CardTitle>
              <CardDescription>Four steps from requirement to your first run.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {steps.map((s, i) => {
                  const body = (
                    <span
                      className={cn(
                        'flex h-full items-start gap-2 rounded-lg border bg-background p-3 text-sm',
                        s.href && !s.done && 'hover:border-primary/50',
                      )}
                    >
                      {s.done ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                      ) : (
                        <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className={cn(s.done && 'text-muted-foreground line-through')}>
                        <span className="sr-only">
                          Step {i + 1}
                          {s.done ? ' (done)' : ''}:{' '}
                        </span>
                        {s.label}
                      </span>
                    </span>
                  );
                  return (
                    <li key={s.label}>
                      {s.href && !s.done ? <Link href={s.href}>{body}</Link> : body}
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric
            title="Requirements coverage"
            icon={FileText}
            footer={
              d && `${d.requirements.covered} of ${d.requirements.total} requirements have tests`
            }
          >
            {!d ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-semibold">{d.requirements.coveragePct ?? 0}%</div>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={d.requirements.coveragePct ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Requirements coverage"
                >
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${d.requirements.coveragePct ?? 0}%` }}
                  />
                </div>
                {d.requirements.highPriorityCoveragePct !== null && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    High priority: {d.requirements.highPriorityCoveragePct}%
                  </p>
                )}
              </>
            )}
          </Metric>
          <Metric
            title="Test cases by status"
            icon={ClipboardCheck}
            footer={d && `${d.testCases.total} test cases`}
          >
            {!d ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                  {TEST_CASE_STATUSES.map(
                    (s) =>
                      d.testCases.byStatus[s] > 0 && (
                        <div
                          key={s}
                          className={STATUS_BAR[s]}
                          style={{
                            width: `${(d.testCases.byStatus[s] / d.testCases.total) * 100}%`,
                          }}
                        />
                      ),
                  )}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {TEST_CASE_STATUSES.map((s) => (
                    <div key={s} className="flex items-center gap-1.5">
                      <span className={cn('size-2 rounded-full', STATUS_BAR[s])} aria-hidden />
                      <dt className="text-muted-foreground">{humanize(s)}</dt>
                      <dd className="ml-auto font-medium">{d.testCases.byStatus[s]}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </Metric>
          <Metric
            title="Last run pass rate"
            icon={PlayCircle}
            footer={
              d?.lastRun && (
                <Link className="hover:underline" href={`${base}/runs/${d.lastRun.ref}`}>
                  {d.lastRun.ref} · {d.lastRun.name}
                </Link>
              )
            }
          >
            {!d ? (
              <Skeleton className="h-8 w-20" />
            ) : !d.lastRun ? (
              <div>
                <div className="text-2xl font-semibold text-muted-foreground">—</div>
                <Link
                  href={`${base}/runs`}
                  className="mt-1 inline-block text-xs text-primary hover:underline"
                >
                  Plan your first run
                </Link>
              </div>
            ) : (
              <>
                <div
                  className={cn(
                    'text-2xl font-semibold',
                    d.lastRun.passRate === null
                      ? 'text-muted-foreground'
                      : d.lastRun.passRate >= 80
                        ? 'text-success-text'
                        : 'text-destructive-text',
                  )}
                >
                  {d.lastRun.passRate === null ? '—' : `${d.lastRun.passRate}%`}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {d.lastRun.failed} failed of {d.lastRun.total} tests
                </p>
              </>
            )}
          </Metric>
          <Metric
            title="Open bugs by severity"
            icon={Bug}
            footer={
              d?.openBugsBySeverity && (
                <Link className="hover:underline" href={`${base}/bugs`}>
                  Open the bug board
                </Link>
              )
            }
          >
            {!d ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-semibold">
                  {Object.values(d.openBugsBySeverity ?? {}).reduce((a, b) => a + b, 0)}
                </div>
                <ul className="mt-2 grid gap-1 text-xs">
                  {BUG_SEVERITIES.filter((s) => (d.openBugsBySeverity?.[s] ?? 0) > 0).map((s) => (
                    <li key={s} className="flex items-center justify-between">
                      <SeverityBadge severity={s} />
                      <span className="font-medium tabular-nums">{d.openBugsBySeverity![s]}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Metric>
          <Metric title="Release readiness" icon={Rocket}>
            <NotYet phase={4} what="Releases" />
          </Metric>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>What needs my attention</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="att-review">
              <div className="mb-2 flex items-center justify-between">
                <h3 id="att-review" className="text-sm font-medium">
                  Test cases to review
                </h3>
                <Link
                  href={`${base}/test-cases?view=review`}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Review queue <ArrowRight className="size-3" />
                </Link>
              </div>
              {!d ? (
                <Skeleton className="h-16" />
              ) : d.attention.toReview.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Nothing waiting for review.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {d.attention.toReview.map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`${base}/test-cases/${t.ref}`}
                        className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"
                      >
                        <Ref>{t.ref}</Ref>
                        <span className="flex-1 truncate">{t.title}</span>
                        {t.aiGenerated && <AiBadge />}
                        <TestCaseStatusBadge status={t.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="att-uncovered">
              <div className="mb-2 flex items-center justify-between">
                <h3 id="att-uncovered" className="text-sm font-medium">
                  High-priority requirements without tests
                </h3>
                <Link
                  href={`${base}/requirements`}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Requirements <ArrowRight className="size-3" />
                </Link>
              </div>
              {!d ? (
                <Skeleton className="h-16" />
              ) : d.attention.uncoveredHighPriority.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  All high-priority requirements have tests.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {d.attention.uncoveredHighPriority.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`${base}/requirements/${r.id}`}
                        className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"
                      >
                        <Ref>{r.ref}</Ref>
                        <span className="flex-1 truncate">{r.title}</span>
                        <PriorityLabel priority={r.priority} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="att-failed">
              <div className="mb-2 flex items-center justify-between">
                <h3 id="att-failed" className="text-sm font-medium">
                  Failed tests in active runs
                </h3>
                <Link
                  href={`${base}/runs`}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Test runs <ArrowRight className="size-3" />
                </Link>
              </div>
              {!d ? (
                <Skeleton className="h-16" />
              ) : d.attention.failedTests.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No failed tests in active runs.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {d.attention.failedTests.map((f) => (
                    <li key={f.resultId}>
                      <Link
                        href={`${base}/runs/${f.run.ref}?result=${f.resultId}`}
                        className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"
                      >
                        <ResultGlyph status="FAILED" />
                        <Ref>{f.ref}</Ref>
                        <span className="flex-1 truncate">{f.title}</span>
                        <span className="text-xs text-muted-foreground">{f.run.ref}</span>
                        {!f.hasBug && (
                          <span className="rounded-md bg-warning-subtle px-1.5 py-0.5 text-[11px] font-medium text-warning-text">
                            No bug yet
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="att-bugs">
              <div className="mb-2 flex items-center justify-between">
                <h3 id="att-bugs" className="text-sm font-medium">
                  Bugs assigned to me
                </h3>
                <Link
                  href={`${base}/bugs`}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Bugs <ArrowRight className="size-3" />
                </Link>
              </div>
              {!d ? (
                <Skeleton className="h-16" />
              ) : d.attention.myBugs.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No open bugs assigned to you.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {d.attention.myBugs.map((b) => (
                    <li key={b.id}>
                      <Link
                        href={`${base}/bugs/${b.ref}`}
                        className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"
                      >
                        <Ref>{b.ref}</Ref>
                        <span className="flex-1 truncate">{b.title}</span>
                        <SeverityBadge severity={b.severity} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
