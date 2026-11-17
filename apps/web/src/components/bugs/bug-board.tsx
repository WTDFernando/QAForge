'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { canMoveBug, humanize, type BugStatus } from '@qaforge/shared';
import { useSetBugStatus } from '@/hooks/bugs';
import type { BugRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { BUG_STATUS_DOT } from '@/components/qa/run-status';
import { BugCard } from './bug-card';

/** Board columns. Reopened bugs show in "New" with the rest of the untriaged work; closing needs a resolution (detail page). */
export const BOARD_COLUMNS: { status: BugStatus; label: string; includes: BugStatus[] }[] = [
  { status: 'NEW', label: 'New', includes: ['NEW', 'REOPENED'] },
  { status: 'TRIAGED', label: 'Triaged', includes: ['TRIAGED'] },
  { status: 'IN_PROGRESS', label: 'In progress', includes: ['IN_PROGRESS'] },
  { status: 'FIXED', label: 'Fixed', includes: ['FIXED'] },
  { status: 'READY_FOR_RETEST', label: 'Ready for retest', includes: ['READY_FOR_RETEST'] },
];

export function BugBoard({
  bugs,
  projectId,
  base,
  people,
  canWrite,
}: {
  bugs: BugRow[];
  projectId: string;
  base: string;
  people: Map<string, { name: string; image: string | null }>;
  canWrite: boolean;
}) {
  const setStatus = useSetBugStatus(projectId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<BugStatus | null>(null);

  const move = async (bug: BugRow, to: BugStatus, beforeId?: string | null) => {
    if (bug.status === to && !beforeId) return;
    if (!canMoveBug(bug.status, to))
      return toast.error(`${bug.ref} can’t go from ${humanize(bug.status)} to ${humanize(to)}`, {
        description: 'Follow the workflow: New → Triaged → In progress → Fixed → Ready for retest.',
      });
    try {
      await setStatus.mutateAsync({ id: bug.id, status: to, beforeId: beforeId ?? null });
      toast.success(`${bug.ref} moved to ${humanize(to)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move the bug');
    }
  };

  return (
    <div className="grid min-h-0 flex-1 auto-cols-[minmax(12.5rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-4">
      {BOARD_COLUMNS.map((col, ci) => {
        const items = bugs.filter((b) => col.includes.includes(b.status));
        return (
          <section
            key={col.status}
            aria-label={`${col.label}, ${items.length} bugs`}
            className={cn(
              'flex min-h-40 flex-col gap-2 rounded-xl bg-sidebar px-2 py-2.5 transition-colors',
              over === col.status && 'bg-accent ring-2 ring-primary/40',
            )}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOver(col.status);
            }}
            onDragLeave={() => setOver((o) => (o === col.status ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const bug = bugs.find((b) => b.id === dragId);
              const before = (e.target as HTMLElement).closest<HTMLElement>('[data-bug-id]')
                ?.dataset.bugId;
              if (bug) void move(bug, col.status, before && before !== bug.id ? before : null);
              setDragId(null);
            }}
          >
            <h2 className="flex items-center gap-2 px-1 text-sm font-semibold">
              <span className={cn('size-2 rounded-full', BUG_STATUS_DOT[col.status])} aria-hidden />
              {col.label}
              <span className="font-normal text-muted-foreground">{items.length}</span>
              <span className="ml-auto text-[11px] font-normal text-muted-foreground" aria-hidden>
                {ci + 1}
              </span>
            </h2>
            <ul className="grid gap-2">
              {items.map((b) => (
                <li key={b.id} data-bug-id={b.id}>
                  <BugCard
                    bug={b}
                    href={`${base}/bugs/${b.ref}`}
                    assignee={b.assigneeId ? people.get(b.assigneeId) : undefined}
                    dragging={dragId === b.id}
                    draggable={canWrite}
                    onDragStart={(e) => {
                      setDragId(b.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDragId(null)}
                    aria-keyshortcuts={canWrite ? '1 2 3 4 5' : undefined}
                    onKeyDown={(e) => {
                      // Keyboard alternative to dragging: 1–5 moves the focused card to that column.
                      const n = Number(e.key);
                      if (!canWrite || !Number.isInteger(n) || n < 1 || n > BOARD_COLUMNS.length)
                        return;
                      e.preventDefault();
                      void move(b, BOARD_COLUMNS[n - 1]!.status);
                    }}
                  />
                </li>
              ))}
            </ul>
            {items.length === 0 && (
              <p className="px-1 py-4 text-center text-xs text-muted-foreground">Nothing here</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
