'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { FailureClass, HttpMethod } from '@qaforge/shared';
import { Topbar } from '@/components/shell/topbar';
import { useCurrentProject } from '@/hooks/queries';
import type { ResultStatus, RunStatus } from '@/hooks/automation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '', label: 'API client' },
  { href: '/tests', label: 'UI tests' },
  { href: '/runs', label: 'Runs' },
  { href: '/ci', label: 'Schedules & CI' },
];

export function useAutomationBase() {
  const { project, org } = useCurrentProject();
  return project && org ? `/${org.slug}/p/${project.key}/automation` : '';
}

/** Topbar + sub-navigation shared by every automation screen (design: Figma "06 API client"). */
export function AutomationHeader({ actions }: { actions?: React.ReactNode }) {
  const { project } = useCurrentProject();
  const base = useAutomationBase();
  const pathname = usePathname();
  const current = TABS.slice()
    .reverse()
    .find((t) => base && (t.href ? pathname.startsWith(base + t.href) : pathname === base));
  return (
    <>
      <Topbar>
        <div className="truncate text-sm text-muted-foreground">
          <span>{project ? `${project.name} › ` : ''}</span>
          <span className="font-medium text-foreground">Automation</span>
        </div>
      </Topbar>
      <div className="flex items-center gap-4 border-b px-6 lg:px-8">
        <nav aria-label="Automation" className="-mb-px flex gap-6 overflow-x-auto">
          {TABS.map((t) => {
            const active = current === t;
            return (
              <Link
                key={t.label}
                href={base + t.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'border-b-2 py-3 text-sm whitespace-nowrap',
                  active
                    ? 'border-primary font-semibold'
                    : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        {actions && <div className="ml-auto flex items-center gap-2 py-2">{actions}</div>}
      </div>
    </>
  );
}

const METHOD_CLS: Record<string, string> = {
  GET: 'text-success-text',
  POST: 'text-primary',
  PUT: 'text-warning-text',
  PATCH: 'text-warning-text',
  DELETE: 'text-destructive-text',
};

export function MethodTag({ method, className }: { method: HttpMethod; className?: string }) {
  return (
    <span
      className={cn(
        'w-10 shrink-0 font-mono text-[11px] font-semibold',
        METHOD_CLS[method] ?? 'text-muted-foreground',
        className,
      )}
    >
      {method === 'DELETE' ? 'DEL' : method === 'OPTIONS' ? 'OPT' : method}
    </span>
  );
}

const RUN_STATUS: Record<RunStatus, [string, string]> = {
  QUEUED: ['Queued', 'bg-muted text-muted-foreground'],
  RUNNING: ['Running', 'bg-primary-subtle text-primary'],
  PASSED: ['Passed', 'bg-success-subtle text-success-text'],
  FAILED: ['Failed', 'bg-destructive-subtle text-destructive-text'],
  ERROR: ['Error', 'bg-destructive-subtle text-destructive-text'],
  CANCELLED: ['Cancelled', 'bg-muted text-muted-foreground'],
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const [label, cls] = RUN_STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold',
        cls,
      )}
    >
      {status === 'RUNNING' && (
        <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      )}
      {label}
    </span>
  );
}

const RESULT_STATUS: Partial<Record<ResultStatus, [string, string]>> = {
  PASSED: ['Passed', 'bg-success-subtle text-success-text'],
  FAILED: ['Failed', 'bg-destructive-subtle text-destructive-text'],
  SKIPPED: ['Skipped', 'bg-muted text-muted-foreground'],
  BLOCKED: ['Blocked', 'bg-blocked-subtle text-blocked-text'],
};

export function ResultBadge({ status, flaky }: { status: ResultStatus; flaky?: boolean }) {
  const [label, cls] = RESULT_STATUS[status] ?? [status, 'bg-muted text-muted-foreground'];
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', cls)}>{label}</span>
      {flaky && (
        <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-xs font-semibold text-warning-text">
          Flaky
        </span>
      )}
    </span>
  );
}

export const FAILURE_LABEL: Record<FailureClass, [string, string]> = {
  PRODUCT_BUG: ['Product bug', 'bg-destructive-subtle text-destructive-text'],
  TEST_BUG: ['Test problem', 'bg-primary-subtle text-primary'],
  FLAKY: ['Flaky', 'bg-warning-subtle text-warning-text'],
  ENVIRONMENT: ['Environment', 'bg-blocked-subtle text-blocked-text'],
};

export function FailureClassBadge({ value }: { value: FailureClass }) {
  const [label, cls] = FAILURE_LABEL[value];
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', cls)}>{label}</span>;
}

export function formatMs(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`;
}
