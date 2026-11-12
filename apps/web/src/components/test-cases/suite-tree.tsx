'use client';
import { useMemo, useState } from 'react';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Inbox,
  Layers,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useBulkTestCases, useSuiteMutations, useSuites } from '@/hooks/qa';
import type { SuiteRow } from '@/lib/types';
import { buildTree, flattenTree } from '@/lib/tree';
import { cn } from '@/lib/utils';

export const TC_DRAG_TYPE = 'application/x-qaforge-test-cases';

/** Selection: undefined = all, 'none' = unsorted, otherwise a suite id. */
export function SuiteTree({
  projectId,
  selected,
  onSelect,
  canEdit,
}: {
  projectId: string;
  selected?: string;
  onSelect: (id?: string) => void;
  canEdit: boolean;
}) {
  const suites = useSuites(projectId);
  const m = useSuiteMutations(projectId);
  const bulk = useBulkTestCases(projectId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [dragSuite, setDragSuite] = useState<string | null>(null);

  const rows = useMemo(
    () => flattenTree(buildTree(suites.data?.suites ?? []), collapsed),
    [suites.data, collapsed],
  );
  const parents = useMemo(
    () => new Set((suites.data?.suites ?? []).map((s) => s.parentId).filter(Boolean)),
    [suites.data],
  );
  const total =
    (suites.data?.suites ?? []).reduce((a, s) => a + s.caseCount, 0) +
    (suites.data?.unsortedCount ?? 0);
  // A suite's count includes its sub-suites (matches the deep filter used when selecting it).
  const rollup = useMemo(() => {
    const all = suites.data?.suites ?? [];
    const out = new Map<string, number>();
    const count = (id: string): number => {
      if (out.has(id)) return out.get(id)!;
      const own = all.find((s) => s.id === id)?.caseCount ?? 0;
      const n = own + all.filter((s) => s.parentId === id).reduce((a, c) => a + count(c.id), 0);
      out.set(id, n);
      return n;
    };
    all.forEach((s) => count(s.id));
    return out;
  }, [suites.data]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return (setAdding(null), setRenaming(null));
    try {
      if (renaming) await m.rename.mutateAsync({ id: renaming, name: n });
      else if (adding) {
        const s = await m.create.mutateAsync({ name: n, parentId: adding.parentId });
        onSelect(s.id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save suite');
    }
    setAdding(null);
    setRenaming(null);
    setName('');
  };

  const dropHandlers = (target: string | null, key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!canEdit) return;
      if (e.dataTransfer.types.includes(TC_DRAG_TYPE) || (dragSuite && target !== dragSuite)) {
        e.preventDefault();
        setDropOn(key);
      }
    },
    onDragLeave: () => setDropOn(null),
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault();
      setDropOn(null);
      const raw = e.dataTransfer.getData(TC_DRAG_TYPE);
      try {
        if (raw) {
          const ids = JSON.parse(raw) as string[];
          await bulk.mutateAsync({ action: 'move', ids, suiteId: target });
          toast.success(`Moved ${ids.length} test case${ids.length > 1 ? 's' : ''}`);
        } else if (dragSuite) {
          await m.move.mutateAsync({ id: dragSuite, parentId: target, beforeId: null });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not move');
      }
      setDragSuite(null);
    },
  });

  const editor = (
    <form onSubmit={submit} className="px-2 py-1">
      <Input
        autoFocus
        size={1}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => e.key === 'Escape' && (setAdding(null), setRenaming(null))}
        placeholder="Suite name"
        aria-label="Suite name"
        className="h-7"
      />
    </form>
  );

  const itemCls = (active: boolean, key: string) =>
    cn(
      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
      active && 'bg-accent font-medium',
      dropOn === key && 'ring-2 ring-primary/60',
    );

  return (
    <nav aria-label="Test suites" className="grid gap-px p-1">
      <button
        className={itemCls(selected === undefined, 'all')}
        onClick={() => onSelect(undefined)}
      >
        <Layers className="size-4 text-muted-foreground" />{' '}
        <span className="flex-1">All test cases</span>
        <span className="text-xs text-muted-foreground">{total}</span>
      </button>
      <button
        className={itemCls(selected === 'none', 'none')}
        onClick={() => onSelect('none')}
        {...dropHandlers(null, 'none')}
      >
        <Inbox className="size-4 text-muted-foreground" /> <span className="flex-1">Unsorted</span>
        <span className="text-xs text-muted-foreground">{suites.data?.unsortedCount ?? 0}</span>
      </button>
      <div className="mt-2 flex items-center justify-between px-2 py-1">
        <span className="text-xs font-medium text-muted-foreground">Suites</span>
        {canEdit && (
          <button
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="New suite"
            onClick={() => (setAdding({ parentId: null }), setName(''))}
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
      {adding?.parentId === null && editor}
      {rows.map(({ item: s, depth }: { item: SuiteRow; depth: number }) => {
        const isOpen = !collapsed.has(s.id);
        const hasKids = parents.has(s.id);
        return (
          <div key={s.id}>
            {renaming === s.id ? (
              editor
            ) : (
              <div
                className={cn(itemCls(selected === s.id, s.id), 'group pr-1')}
                style={{ paddingLeft: depth * 14 + 4 }}
                draggable={canEdit}
                onDragStart={(e) => (
                  setDragSuite(s.id),
                  e.dataTransfer.setData('text/plain', s.name)
                )}
                onDragEnd={() => setDragSuite(null)}
                {...dropHandlers(s.id, s.id)}
              >
                <button
                  className={cn('rounded p-0.5 text-muted-foreground', !hasKids && 'invisible')}
                  onClick={() =>
                    setCollapsed((c) => {
                      const n = new Set(c);
                      if (n.has(s.id)) n.delete(s.id);
                      else n.add(s.id);
                      return n;
                    })
                  }
                  aria-label={isOpen ? `Collapse ${s.name}` : `Expand ${s.name}`}
                  tabIndex={hasKids ? 0 : -1}
                >
                  <ChevronRight
                    className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')}
                  />
                </button>
                <button
                  className="flex min-w-0 flex-1 items-center gap-2"
                  onClick={() => onSelect(s.id)}
                  aria-current={selected === s.id ? 'true' : undefined}
                >
                  {selected === s.id ? (
                    <FolderOpen className="size-4 shrink-0 text-primary" />
                  ) : (
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{s.name}</span>
                </button>
                <span className="text-xs text-muted-foreground">
                  {rollup.get(s.id) ?? s.caseCount}
                </span>
                {canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-background"
                      aria-label={`Actions for ${s.name}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onSelect={() => (
                          setAdding({ parentId: s.id }),
                          setName(''),
                          setCollapsed((c) => {
                            const n = new Set(c);
                            n.delete(s.id);
                            return n;
                          })
                        )}
                      >
                        New sub-suite
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => (setRenaming(s.id), setName(s.name))}>
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() =>
                          m.remove.mutate(s.id, {
                            onSuccess: () => {
                              toast.success(
                                `Suite "${s.name}" deleted; its test cases moved up a level`,
                              );
                              if (selected === s.id) onSelect(s.parentId ?? undefined);
                            },
                          })
                        }
                      >
                        Delete suite
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}
            {adding?.parentId === s.id && (
              <div style={{ paddingLeft: (depth + 1) * 14 }}>{editor}</div>
            )}
          </div>
        );
      })}
      {rows.length === 0 && !adding && canEdit && (
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-muted-foreground"
          onClick={() => (setAdding({ parentId: null }), setName(''))}
        >
          <Plus /> Create a suite
        </Button>
      )}
    </nav>
  );
}
