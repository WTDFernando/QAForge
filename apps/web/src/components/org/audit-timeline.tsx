'use client';
import { Bot, Cog, KeyRound } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useAudit, useMembers } from '@/hooks/queries';
import type { AuditEntry } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

const VERB: Record<string, string> = {
  create: 'created',
  update: 'updated',
  delete: 'removed',
  archive: 'archived',
  restore: 'restored',
  approve: 'approved',
  reject: 'rejected',
};

function fmt(v: unknown) {
  if (v === null || v === undefined || v === '') return '—';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export function describeEntry(e: AuditEntry): string {
  const verb = VERB[e.action] ?? e.action;
  const entity = e.entityType.replace(/_/g, ' ');
  return `${verb} ${entity}`;
}

export function AuditTimeline({
  orgId,
  projectId,
  compact = false,
}: {
  orgId: string;
  projectId?: string;
  compact?: boolean;
}) {
  const audit = useAudit(orgId, { projectId });
  const members = useMembers(orgId);
  const nameOf = (id: string | null) =>
    members.data?.find((m) => m.user.id === id)?.user.name ?? 'Someone';

  if (audit.isLoading)
    return (
      <div className="grid gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  if (audit.error)
    return (
      <p className="text-sm text-muted-foreground">Activity is visible to QA Leads and Admins.</p>
    );
  const items = compact ? audit.data!.items.slice(0, 8) : audit.data!.items;
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>;

  return (
    <ol className="relative grid gap-4 before:absolute before:top-2 before:bottom-2 before:left-3.5 before:w-px before:bg-border">
      {items.map((e) => {
        const actor =
          e.actorType === 'USER'
            ? nameOf(e.actorId)
            : e.actorType === 'AI_AGENT'
              ? 'AI agent'
              : e.actorType === 'API_TOKEN'
                ? 'API token'
                : 'System';
        const Icon =
          e.actorType === 'AI_AGENT' ? Bot : e.actorType === 'API_TOKEN' ? KeyRound : Cog;
        return (
          <li key={e.id} className="relative flex gap-3">
            {e.actorType === 'USER' ? (
              <Avatar name={actor} className="relative ring-4 ring-card" />
            ) : (
              <span className="relative flex size-7 items-center justify-center rounded-full bg-muted ring-4 ring-card">
                <Icon className="size-3.5" />
              </span>
            )}
            <div className="min-w-0 flex-1 pt-0.5 text-sm">
              <p>
                <span className="font-medium">{actor}</span>{' '}
                <span className="text-muted-foreground">{describeEntry(e)}</span>
                <span className="ml-2 text-xs text-muted-foreground">{timeAgo(e.createdAt)}</span>
              </p>
              {!compact && e.changes && (
                <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                  {Object.entries(e.changes).map(([field, c]) => (
                    <li key={field}>
                      <span className="font-mono">{field}</span>:{' '}
                      {e.action !== 'create' && c.from !== null && (
                        <>
                          <span className="line-through">{fmt(c.from)}</span> →{' '}
                        </>
                      )}
                      <span className="text-foreground">{fmt(c.to)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
