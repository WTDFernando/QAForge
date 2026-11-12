'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Layers, Puzzle, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import type { RequirementType } from '@qaforge/shared';
import { useMoveRequirement } from '@/hooks/qa';
import type { RequirementRow } from '@/lib/types';
import { buildTree, filterTree, flattenTree } from '@/lib/tree';
import { cn } from '@/lib/utils';

export const TYPE_ICON: Record<RequirementType, React.ElementType> = {
  EPIC: Layers,
  FEATURE: Puzzle,
  STORY: ScrollText,
};
const TYPE_COLOR: Record<RequirementType, string> = {
  EPIC: 'text-violet-500',
  FEATURE: 'text-sky-500',
  STORY: 'text-muted-foreground',
};

type Drop = { id: string; mode: 'before' | 'into' } | null;

/**
 * Epic > Feature > Story tree. Drag a row onto another row to nest it,
 * or onto the top edge of a row to place it before that row.
 */
export function RequirementTree({
  projectId,
  rows,
  basePath,
  selectedId,
  query,
  canEdit,
}: {
  projectId: string;
  rows: RequirementRow[];
  basePath: string;
  selectedId?: string;
  query: string;
  canEdit: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const move = useMoveRequirement(projectId);

  const visible = useMemo(() => {
    let tree = buildTree(rows);
    const q = query.trim().toLowerCase();
    if (q)
      tree = filterTree(
        tree,
        (r) => r.title.toLowerCase().includes(q) || r.ref.toLowerCase().includes(q),
      );
    return flattenTree(tree, q ? new Set() : collapsed);
  }, [rows, collapsed, query]);
  const hasChildren = useMemo(
    () => new Set(rows.map((r) => r.parentId).filter(Boolean) as string[]),
    [rows],
  );
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const onDrop = async () => {
    if (!dragId || !drop || dragId === drop.id) return;
    const target = byId.get(drop.id)!;
    const input =
      drop.mode === 'into'
        ? { parentId: target.id, beforeId: null }
        : { parentId: target.parentId, beforeId: target.id };
    try {
      await move.mutateAsync({ id: dragId, ...input });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move requirement');
    }
  };

  if (visible.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        {query ? 'No matching requirements.' : 'No requirements yet.'}
      </p>
    );
  }

  return (
    <ul
      role="tree"
      aria-label="Requirements"
      className="grid grid-cols-[minmax(0,1fr)] gap-px py-1"
    >
      {visible.map(({ item: r, depth }) => {
        const Icon = TYPE_ICON[r.type];
        const isParent = hasChildren.has(r.id);
        const isOpen = !collapsed.has(r.id);
        return (
          <li
            key={r.id}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={r.id === selectedId}
            aria-expanded={isParent ? isOpen : undefined}
            draggable={canEdit}
            onDragStart={(e) => {
              setDragId(r.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', r.ref);
            }}
            onDragEnd={() => (setDragId(null), setDrop(null))}
            onDragOver={(e) => {
              if (!dragId || dragId === r.id) return;
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              setDrop({
                id: r.id,
                mode: e.clientY - rect.top < rect.height * 0.3 ? 'before' : 'into',
              });
            }}
            onDrop={(e) => {
              e.preventDefault();
              void onDrop();
              setDrop(null);
            }}
            className={cn(
              'relative',
              drop?.id === r.id && drop.mode === 'into' && 'rounded-md ring-2 ring-primary/60',
              drop?.id === r.id &&
                drop.mode === 'before' &&
                'before:absolute before:inset-x-2 before:-top-px before:h-0.5 before:rounded before:bg-primary',
              dragId === r.id && 'opacity-50',
            )}
          >
            <div
              className={cn(
                'group flex items-center gap-1 rounded-md pr-2 text-sm hover:bg-accent',
                r.id === selectedId && 'bg-accent',
              )}
              style={{ paddingLeft: depth * 16 + 4 }}
            >
              <button
                type="button"
                onClick={() => toggle(r.id)}
                className={cn(
                  'rounded p-0.5 text-muted-foreground hover:text-foreground',
                  !isParent && 'invisible',
                )}
                aria-label={isOpen ? `Collapse ${r.title}` : `Expand ${r.title}`}
                tabIndex={isParent ? 0 : -1}
              >
                <ChevronRight
                  className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')}
                />
              </button>
              <Link
                href={`${basePath}/requirements/${r.id}`}
                className="flex min-w-0 flex-1 items-center gap-2 py-1.5 outline-none focus-visible:underline"
                aria-current={r.id === selectedId ? 'page' : undefined}
              >
                <Icon className={cn('size-3.5 shrink-0', TYPE_COLOR[r.type])} aria-hidden />
                <span
                  className={cn(
                    'truncate',
                    r.status === 'OBSOLETE' && 'text-muted-foreground line-through',
                  )}
                >
                  {r.title}
                </span>
              </Link>
              <span
                className={cn(
                  'shrink-0 rounded px-1 text-[10px] tabular-nums',
                  r.testCaseCount
                    ? 'bg-success/15 text-success-text'
                    : 'bg-muted text-muted-foreground',
                )}
                title={`${r.testCaseCount} linked test case(s)`}
              >
                {r.testCaseCount}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
