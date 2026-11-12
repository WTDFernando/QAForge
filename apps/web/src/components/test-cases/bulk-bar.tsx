'use client';
import { Tag, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  humanize,
  PRIORITIES,
  TEST_CASE_STATUSES,
  type BulkTestCaseInput,
  type Priority,
  type TestCaseStatus,
} from '@qaforge/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useBulkTestCases, useSuites, type BulkResult } from '@/hooks/qa';
import { useCan } from '@/hooks/use-permission';

/** Floating action bar for the current selection. Every action offers Undo. */
export function BulkBar({
  projectId,
  ids,
  onClear,
}: {
  projectId: string;
  ids: string[];
  onClear: () => void;
}) {
  const bulk = useBulkTestCases(projectId);
  const suites = useSuites(projectId);
  const canWrite = useCan('testcase:write');
  const canApprove = useCan('testcase:approve');
  if (ids.length === 0) return null;

  /** Re-apply previous values grouped by value (one request per distinct value). */
  const undo = async (res: BulkResult, field: 'status' | 'priority' | 'suiteId') => {
    const groups = new Map<string, string[]>();
    for (const p of res.previous)
      groups.set(String(p[field]), [...(groups.get(String(p[field])) ?? []), p.id]);
    for (const [value, groupIds] of groups) {
      if (field === 'status')
        await bulk.mutateAsync({
          action: 'setStatus',
          ids: groupIds,
          status: value as TestCaseStatus,
        });
      if (field === 'priority')
        await bulk.mutateAsync({
          action: 'setPriority',
          ids: groupIds,
          priority: value as Priority,
        });
      if (field === 'suiteId')
        await bulk.mutateAsync({
          action: 'move',
          ids: groupIds,
          suiteId: value === 'null' ? null : value,
        });
    }
    toast.success('Undone');
  };

  const run = async (
    input: BulkTestCaseInput,
    message: string,
    undoField?: 'status' | 'priority' | 'suiteId',
  ) => {
    try {
      const res = await bulk.mutateAsync(input);
      onClear();
      toast.success(message, {
        action: undoField
          ? {
              label: 'Undo',
              onClick: () => void undo(res, undoField).catch((e) => toast.error(e.message)),
            }
          : input.action === 'delete'
            ? {
                label: 'Undo',
                onClick: () =>
                  bulk.mutate(
                    { action: 'restore', ids: input.ids },
                    { onSuccess: () => toast.success('Restored') },
                  ),
              }
            : undefined,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bulk update failed');
    }
  };
  const n = `${ids.length} test case${ids.length > 1 ? 's' : ''}`;

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="sticky bottom-4 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-1 rounded-xl border bg-popover p-1.5 shadow-lg"
    >
      <span className="px-2 text-sm font-medium">{ids.length} selected</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" disabled={!canWrite && !canApprove}>
            Status
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {TEST_CASE_STATUSES.filter((s) => canWrite || s === 'APPROVED').map((s) => (
            <DropdownMenuItem
              key={s}
              onSelect={() =>
                run({ action: 'setStatus', ids, status: s }, `${n} set to ${humanize(s)}`, 'status')
              }
            >
              {humanize(s)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {canWrite && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                Priority
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {PRIORITIES.map((p) => (
                <DropdownMenuItem
                  key={p}
                  onSelect={() =>
                    run(
                      { action: 'setPriority', ids, priority: p },
                      `${n} set to ${humanize(p)}`,
                      'priority',
                    )
                  }
                >
                  {humanize(p)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                Move
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-72 overflow-y-auto">
              <DropdownMenuItem
                onSelect={() =>
                  run({ action: 'move', ids, suiteId: null }, `${n} moved to Unsorted`, 'suiteId')
                }
              >
                Unsorted
              </DropdownMenuItem>
              {suites.data?.suites.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onSelect={() =>
                    run(
                      { action: 'move', ids, suiteId: s.id },
                      `${n} moved to ${s.name}`,
                      'suiteId',
                    )
                  }
                >
                  {s.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                <Tag /> Tag
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 p-2">
              <DropdownMenuLabel className="px-0">
                Add tag (Enter) · remove with “-tag”
              </DropdownMenuLabel>
              <input
                className="h-8 w-full rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                placeholder="e.g. regression"
                aria-label="Tag"
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key !== 'Enter') return;
                  const raw = e.currentTarget.value.trim().toLowerCase();
                  if (!raw) return;
                  if (raw.startsWith('-'))
                    void run(
                      { action: 'removeTags', ids, tags: [raw.slice(1)] },
                      `Removed #${raw.slice(1)}`,
                    );
                  else
                    void run({ action: 'addTags', ids, tags: [raw] }, `Tagged ${n} with #${raw}`);
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => run({ action: 'delete', ids }, `Deleted ${n}`)}
          >
            <Trash2 /> Delete
          </Button>
        </>
      )}
      <Button size="icon-sm" variant="ghost" aria-label="Clear selection" onClick={onClear}>
        <X />
      </Button>
    </div>
  );
}
