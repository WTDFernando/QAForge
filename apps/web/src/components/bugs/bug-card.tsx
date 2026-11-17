'use client';
import Link from 'next/link';
import { Copy, MessageSquare, Paperclip, Sparkles } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { SeverityBadge } from '@/components/qa/run-status';
import type { BugRow } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Kanban card (Figma: "Bug card"). The whole card is a link; drag handlers come from the board. */
export function BugCard({
  bug,
  href,
  assignee,
  dragging,
  ...rest
}: {
  bug: BugRow;
  href: string;
  assignee?: { name: string; image: string | null };
  dragging?: boolean;
} & React.ComponentProps<'a'>) {
  return (
    <Link
      href={href}
      className={cn(
        'grid gap-2 rounded-[10px] border bg-card px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(15,18,25,0.06)] transition-shadow outline-none hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50',
        dragging && 'opacity-50',
      )}
      {...rest}
    >
      <span className="flex items-center gap-1.5">
        <span className="flex-1 font-mono text-[11px] text-muted-foreground">{bug.ref}</span>
        <SeverityBadge severity={bug.severity} />
      </span>
      <span className="line-clamp-3 text-sm font-medium">{bug.title}</span>
      {bug.possibleDuplicate && bug.status === 'NEW' && (
        <span className="flex items-center gap-1.5 rounded-md bg-warning-subtle px-2 py-1 text-[11px] font-medium text-warning-text">
          <Copy className="size-3" aria-hidden />
          Looks like {bug.possibleDuplicate.ref} (
          {Math.round(bug.possibleDuplicate.similarity * 100)}%)
        </span>
      )}
      <span className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {bug.component && (
          <span className="rounded-[5px] bg-muted px-1.5 py-px font-medium">{bug.component}</span>
        )}
        {bug.aiGenerated && (
          <span className="inline-flex items-center gap-0.5 rounded-[5px] bg-primary-subtle px-1.5 py-px font-medium text-primary">
            <Sparkles className="size-3" aria-hidden />
            AI{bug.aiConfidence !== null && ` ${Math.round(bug.aiConfidence * 100)}%`}
          </span>
        )}
        <span className="flex-1" />
        {bug.attachmentCount > 0 && (
          <span
            className="inline-flex items-center gap-0.5"
            aria-label={`${bug.attachmentCount} attachments`}
          >
            <Paperclip className="size-3" aria-hidden />
            {bug.attachmentCount}
          </span>
        )}
        {bug.commentCount > 0 && (
          <span
            className="inline-flex items-center gap-0.5"
            aria-label={`${bug.commentCount} comments`}
          >
            <MessageSquare className="size-3" aria-hidden />
            {bug.commentCount}
          </span>
        )}
        {assignee && <Avatar name={assignee.name} src={assignee.image} className="size-5" />}
      </span>
    </Link>
  );
}
