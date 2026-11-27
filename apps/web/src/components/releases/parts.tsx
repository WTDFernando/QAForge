import type { ReadinessBand, ReleaseStatus } from '@qaforge/shared';
import { cn } from '@/lib/utils';

const STATUS: Record<ReleaseStatus, [string, string]> = {
  DRAFT: ['Draft', 'bg-muted text-muted-foreground'],
  PENDING_APPROVAL: ['Waiting for approval', 'bg-primary-subtle text-primary'],
  APPROVED: ['Approved', 'bg-success-subtle text-success-text'],
  REJECTED: ['Rejected', 'bg-destructive-subtle text-destructive-text'],
  RELEASED: ['Released', 'bg-success-subtle text-success-text'],
};

export function ReleaseStatusBadge({ status }: { status: ReleaseStatus }) {
  const [label, cls] = STATUS[status];
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', cls)}>
      {label}
    </span>
  );
}

export const BAND: Record<
  ReadinessBand,
  { label: string; text: string; pill: string; bar: string }
> = {
  READY: {
    label: 'Ready',
    text: 'text-success-text',
    pill: 'bg-success-subtle text-success-text',
    bar: 'bg-success',
  },
  AT_RISK: {
    label: 'At risk',
    text: 'text-warning-text',
    pill: 'bg-warning-subtle text-warning-text',
    bar: 'bg-warning',
  },
  NOT_READY: {
    label: 'Not ready',
    text: 'text-destructive-text',
    pill: 'bg-destructive-subtle text-destructive-text',
    bar: 'bg-destructive',
  },
  BLOCKED: {
    label: 'Blocked',
    text: 'text-destructive-text',
    pill: 'bg-destructive-subtle text-destructive-text',
    bar: 'bg-destructive',
  },
};

export function ReadinessBadge({
  band,
  blockingFailed,
}: {
  band: ReadinessBand;
  blockingFailed?: number;
}) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        BAND[band].pill,
      )}
    >
      {BAND[band].label}
      {band === 'BLOCKED' && blockingFailed
        ? ` · ${blockingFailed} gate${blockingFailed === 1 ? '' : 's'}`
        : ''}
    </span>
  );
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
