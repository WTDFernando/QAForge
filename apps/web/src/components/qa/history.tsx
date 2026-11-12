'use client';
import { History } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useMembers } from '@/hooks/queries';
import { useVersions } from '@/hooks/qa';
import { timeAgo } from '@/lib/utils';

/** Version list with who/when and what changed between consecutive versions. */
export function VersionHistory({
  projectId,
  orgId,
  kind,
  id,
}: {
  projectId: string;
  orgId: string;
  kind: 'requirements' | 'test-cases';
  id: string;
}) {
  const versions = useVersions(projectId, kind, id);
  const members = useMembers(orgId);
  const name = (uid: string) =>
    members.data?.find((m) => m.user.id === uid)?.user.name ?? 'Someone';
  if (versions.isLoading) return <Skeleton className="h-16" />;
  const list = versions.data ?? [];
  return (
    <ol className="grid gap-3">
      {list.map((v, i) => {
        const prev = list[i + 1]?.snapshot;
        const changed = prev
          ? Object.keys(v.snapshot).filter(
              (k) =>
                k !== 'changeNote' && JSON.stringify(v.snapshot[k]) !== JSON.stringify(prev[k]),
            )
          : [];
        return (
          <li key={v.id} className="flex gap-3 text-sm">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
              v{v.version}
            </span>
            <div className="min-w-0">
              <p>
                <span className="font-medium">{name(v.createdById)}</span>{' '}
                <span className="text-muted-foreground">
                  {prev ? (changed.length ? `changed ${changed.join(', ')}` : 'saved') : 'created'}
                </span>{' '}
                <span className="text-xs text-muted-foreground">{timeAgo(v.createdAt)}</span>
              </p>
              {typeof v.snapshot.changeNote === 'string' && (
                <p className="text-xs text-muted-foreground">“{v.snapshot.changeNote}”</p>
              )}
            </div>
          </li>
        );
      })}
      {list.length === 0 && (
        <li className="flex items-center gap-2 text-sm text-muted-foreground">
          <History className="size-4" /> No history yet.
        </li>
      )}
    </ol>
  );
}
