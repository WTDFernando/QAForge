import { Bot, ChevronsUp, ChevronUp, Equal, ChevronDown } from 'lucide-react';
import {
  humanize,
  type Priority,
  type RequirementStatus,
  type TestCaseStatus,
} from '@qaforge/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Status colours carry meaning only: approved = green, in review = amber, deprecated/obsolete = muted. */
const TC_VARIANT: Record<TestCaseStatus, 'secondary' | 'warning' | 'success' | 'outline'> = {
  DRAFT: 'secondary',
  IN_REVIEW: 'warning',
  APPROVED: 'success',
  DEPRECATED: 'outline',
};

export function TestCaseStatusBadge({ status }: { status: TestCaseStatus }) {
  return (
    <Badge
      variant={TC_VARIANT[status]}
      className={cn(status === 'DEPRECATED' && 'text-muted-foreground line-through')}
    >
      {humanize(status)}
    </Badge>
  );
}

export function RequirementStatusBadge({ status }: { status: RequirementStatus }) {
  return (
    <Badge
      variant={status === 'APPROVED' ? 'success' : status === 'OBSOLETE' ? 'outline' : 'secondary'}
    >
      {humanize(status)}
    </Badge>
  );
}

const PRIORITY_ICON: Record<Priority, React.ElementType> = {
  CRITICAL: ChevronsUp,
  HIGH: ChevronUp,
  MEDIUM: Equal,
  LOW: ChevronDown,
};

export function PriorityLabel({ priority, className }: { priority: Priority; className?: string }) {
  const Icon = PRIORITY_ICON[priority];
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm', className)}>
      <Icon
        className={cn(
          'size-4',
          priority === 'CRITICAL'
            ? 'text-destructive'
            : priority === 'HIGH'
              ? 'text-warning'
              : 'text-muted-foreground',
        )}
        aria-hidden
      />
      {humanize(priority)}
    </span>
  );
}

export function AiBadge({ confidence }: { confidence?: number | null }) {
  return (
    <Badge variant="ai" title="Drafted by AI. Review before approving.">
      <Bot className="size-3" /> AI{confidence != null && ` · ${Math.round(confidence * 100)}%`}
    </Badge>
  );
}

export function Ref({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs text-muted-foreground">{children}</span>;
}
