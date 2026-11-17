import { Ban, Check, Clock, Play, SkipForward, X } from 'lucide-react';
import {
  humanize,
  type BugSeverity,
  type BugStatus,
  type ResultStatus,
  type TestRunStatus,
} from '@qaforge/shared';
import { cn } from '@/lib/utils';
import type { RunCounts } from '@/lib/types';

/**
 * Result and severity visuals from the Figma library ("Result status", "Severity").
 * Every state pairs an icon or glyph with its label so meaning never relies on colour (WCAG 1.4.1).
 */
export const RESULT_META: Record<
  ResultStatus,
  { label: string; icon: React.ElementType | null; pill: string; solid: string; bar: string }
> = {
  PASSED: {
    label: 'Passed',
    icon: Check,
    pill: 'bg-success-subtle text-success-text',
    solid: 'bg-success text-white',
    bar: 'bg-success',
  },
  FAILED: {
    label: 'Failed',
    icon: X,
    pill: 'bg-destructive-subtle text-destructive-text',
    solid: 'bg-destructive text-white',
    bar: 'bg-destructive',
  },
  BLOCKED: {
    label: 'Blocked',
    icon: Ban,
    pill: 'bg-blocked-subtle text-blocked-text',
    solid: 'bg-blocked text-white',
    bar: 'bg-blocked',
  },
  SKIPPED: {
    label: 'Skipped',
    icon: SkipForward,
    pill: 'bg-muted text-muted-foreground',
    solid: 'bg-muted-foreground text-white',
    bar: 'bg-muted-foreground',
  },
  RETEST: {
    label: 'Retest',
    icon: Clock,
    pill: 'bg-warning-subtle text-warning-text',
    solid: 'bg-warning text-white',
    bar: 'bg-warning',
  },
  UNTESTED: {
    label: 'Untested',
    icon: null,
    pill: 'bg-muted text-muted-foreground',
    solid: '',
    bar: 'bg-muted',
  },
};

export function ResultBadge({ status, className }: { status: ResultStatus; className?: string }) {
  const m = RESULT_META[status];
  const Icon = m.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        m.pill,
        className,
      )}
    >
      {Icon ? (
        <Icon className="size-3" aria-hidden />
      ) : (
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
      )}
      {m.label}
    </span>
  );
}

/** Round status glyph used in the execution case list. */
export function ResultGlyph({ status, className }: { status: ResultStatus; className?: string }) {
  const m = RESULT_META[status];
  const Icon = m.icon;
  return (
    <span
      className={cn(
        'flex size-[18px] shrink-0 items-center justify-center rounded-full',
        Icon ? m.solid : 'border-[1.5px] border-dashed border-muted-foreground/70',
        className,
      )}
      role="img"
      aria-label={m.label}
    >
      {Icon && <Icon className="size-[11px]" strokeWidth={3} aria-hidden />}
    </span>
  );
}

const SEVERITY: Record<BugSeverity, { level: number; cls: string }> = {
  BLOCKER: { level: 4, cls: 'bg-destructive-text text-background' },
  CRITICAL: { level: 4, cls: 'bg-destructive-subtle text-destructive-text' },
  MAJOR: { level: 3, cls: 'bg-warning-subtle text-warning-text' },
  MINOR: { level: 2, cls: 'bg-primary-subtle text-primary' },
  TRIVIAL: { level: 1, cls: 'bg-muted text-muted-foreground' },
};

export function SeverityBadge({
  severity,
  className,
}: {
  severity: BugSeverity;
  className?: string;
}) {
  const s = SEVERITY[severity];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md py-0.5 pr-2 pl-1.5 text-xs font-medium',
        s.cls,
        className,
      )}
    >
      <span className="flex items-end gap-px" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn('w-[2.5px] rounded-[1px] bg-current', i >= s.level && 'opacity-25')}
            style={{ height: 4 + i * 2 }}
          />
        ))}
      </span>
      {humanize(severity)}
    </span>
  );
}

export const BUG_STATUS_DOT: Record<BugStatus, string> = {
  NEW: 'bg-muted-foreground',
  TRIAGED: 'bg-primary',
  IN_PROGRESS: 'bg-warning',
  FIXED: 'bg-blocked',
  READY_FOR_RETEST: 'bg-success',
  CLOSED: 'bg-border',
  REOPENED: 'bg-destructive',
};

export function RunStatusPill({ status }: { status: TestRunStatus }) {
  const active = status === 'IN_PROGRESS';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        active
          ? 'bg-primary-subtle text-primary'
          : status === 'COMPLETED'
            ? 'bg-success-subtle text-success-text'
            : 'bg-muted text-muted-foreground',
      )}
    >
      {active ? (
        <Play className="size-3" aria-hidden />
      ) : status === 'COMPLETED' ? (
        <Check className="size-3" aria-hidden />
      ) : (
        <Clock className="size-3" aria-hidden />
      )}
      {humanize(status)}
    </span>
  );
}

const ORDER: ResultStatus[] = ['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED', 'RETEST', 'UNTESTED'];

/** Segmented progress bar: one segment per result status, proportional to its count. */
export function RunProgressBar({ counts, className }: { counts: RunCounts; className?: string }) {
  const label = ORDER.filter((s) => counts.byStatus[s])
    .map((s) => `${counts.byStatus[s]} ${RESULT_META[s].label.toLowerCase()}`)
    .join(', ');
  return (
    <div
      className={cn('flex h-2 w-full gap-0.5 overflow-hidden rounded-full', className)}
      role="img"
      aria-label={
        counts.total ? `${counts.executed} of ${counts.total} done: ${label}` : 'No tests'
      }
    >
      {counts.total === 0 ? (
        <span className="flex-1 bg-muted" />
      ) : (
        ORDER.map((s) =>
          counts.byStatus[s] ? (
            <span
              key={s}
              className={cn('h-full first:rounded-l-full last:rounded-r-full', RESULT_META[s].bar)}
              style={{ flexGrow: counts.byStatus[s] }}
            />
          ) : null,
        )
      )}
    </div>
  );
}

export function RunLegend({ counts }: { counts: RunCounts }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {ORDER.filter((s) => s !== 'RETEST' || counts.byStatus.RETEST).map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span
            className={cn(
              'size-2 rounded-full',
              s === 'UNTESTED' ? 'bg-border' : RESULT_META[s].bar,
            )}
            aria-hidden
          />
          <span className="font-semibold tabular-nums">{counts.byStatus[s]}</span>
          <span className="text-muted-foreground">{RESULT_META[s].label}</span>
        </li>
      ))}
    </ul>
  );
}
