'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  useReactTable,
  type RowSelectionState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronRight, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import {
  canTransition,
  hasPermission,
  humanize,
  PRIORITIES,
  TEST_CASE_STATUSES,
  type Priority,
  type Role,
} from '@qaforge/shared';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AiBadge, PriorityLabel, Ref, TestCaseStatusBadge } from '@/components/qa/status';
import { useBulkTestCases, useSetTestCaseStatus } from '@/hooks/qa';
import type { TestCaseRow } from '@/lib/types';
import type { TestCaseViewState } from '@/lib/test-case-view';
import { cn, timeAgo } from '@/lib/utils';
import { TC_DRAG_TYPE } from './suite-tree';

const col = createColumnHelper<TestCaseRow>();
const SORTABLE = new Set(['ref', 'title', 'priority', 'status', 'updatedAt']);

export function TestCaseTable({
  projectId,
  rows,
  basePath,
  view,
  setView,
  selection,
  setSelection,
  role,
}: {
  projectId: string;
  rows: TestCaseRow[];
  basePath: string;
  view: TestCaseViewState;
  setView: (v: TestCaseViewState) => void;
  selection: RowSelectionState;
  setSelection: (s: RowSelectionState) => void;
  role: Role;
}) {
  // Only the stable `mutate` functions go into the column memo; the mutation objects change every render.
  const { mutate: setStatusMutate } = useSetTestCaseStatus(projectId);
  const { mutate: bulkMutate } = useBulkTestCases(projectId);
  const canWrite = hasPermission(role, 'testcase:write');
  const canApprove = hasPermission(role, 'testcase:approve');

  const columns = useMemo(
    () => [
      col.display({
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all on this page"
            checked={
              table.getIsAllRowsSelected()
                ? true
                : table.getIsSomeRowsSelected()
                  ? 'indeterminate'
                  : false
            }
            onCheckedChange={(c) => table.toggleAllRowsSelected(c === true)}
          />
        ),
        cell: ({ row }) =>
          row.getIsGrouped() ? null : (
            <Checkbox
              aria-label={`Select ${row.original.ref}`}
              checked={row.getIsSelected()}
              onCheckedChange={(c) => row.toggleSelected(c === true)}
            />
          ),
      }),
      col.accessor('ref', { id: 'ref', header: 'ID', cell: (c) => <Ref>{c.getValue()}</Ref> }),
      col.accessor('title', {
        id: 'title',
        header: 'Title',
        cell: ({ row }) => (
          <div className="flex min-w-64 items-center gap-2">
            <Link
              href={`${basePath}/test-cases/${row.original.ref}`}
              className="truncate font-medium hover:underline"
            >
              {row.original.title}
            </Link>
            {row.original.aiGenerated && <AiBadge confidence={row.original.aiConfidence} />}
          </div>
        ),
      }),
      col.accessor('status', {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const t = row.original;
          const targets = TEST_CASE_STATUSES.filter(
            (s) =>
              s !== t.status &&
              canTransition(t.status, s) &&
              (s === 'APPROVED' ? canApprove : canWrite),
          );
          if (!targets.length) return <TestCaseStatusBadge status={t.status} />;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label={`${humanize(t.status)}: change status of ${t.ref}`}
              >
                <TestCaseStatusBadge status={t.status} />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {targets.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onSelect={() =>
                      setStatusMutate(
                        { id: t.id, status: s },
                        {
                          onSuccess: () =>
                            toast.success(`${t.ref} → ${humanize(s)}`, {
                              action: canTransition(s, t.status)
                                ? {
                                    label: 'Undo',
                                    onClick: () => setStatusMutate({ id: t.id, status: t.status }),
                                  }
                                : undefined,
                            }),
                          onError: (e) => toast.error(e.message),
                        },
                      )
                    }
                  >
                    {humanize(s)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      }),
      col.accessor('priority', {
        id: 'priority',
        header: 'Priority',
        cell: ({ row }) => {
          const t = row.original;
          if (!canWrite) return <PriorityLabel priority={t.priority} />;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label={`${humanize(t.priority)}: change priority of ${t.ref}`}
              >
                <PriorityLabel priority={t.priority} />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {PRIORITIES.map((p) => (
                  <DropdownMenuItem
                    key={p}
                    onSelect={() =>
                      bulkMutate(
                        { action: 'setPriority', ids: [t.id], priority: p as Priority },
                        { onError: (e) => toast.error(e.message) },
                      )
                    }
                  >
                    {humanize(p)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      }),
      col.accessor('type', { id: 'type', header: 'Type', cell: (c) => humanize(c.getValue()) }),
      col.accessor((r) => r.technique ?? '', {
        id: 'technique',
        header: 'Technique',
        cell: (c) => (c.getValue() ? humanize(c.getValue()) : '—'),
      }),
      col.accessor('automationStatus', {
        id: 'automationStatus',
        header: 'Automation',
        cell: (c) => humanize(c.getValue()),
      }),
      col.accessor((r) => r.suite?.name ?? 'Unsorted', {
        id: 'suite',
        header: 'Suite',
        cell: (c) => <span className="text-muted-foreground">{c.getValue()}</span>,
      }),
      col.accessor((r) => r.requirements.map((x) => x.ref).join(', '), {
        id: 'requirements',
        header: 'Requirements',
        cell: ({ row }) =>
          row.original.requirements.length ? (
            <div className="flex gap-1">
              {row.original.requirements.slice(0, 2).map((r) => (
                <Link key={r.id} href={`${basePath}/requirements/${r.id}`} title={r.title}>
                  <Badge variant="outline" className="font-mono">
                    {r.ref}
                  </Badge>
                </Link>
              ))}
              {row.original.requirements.length > 2 && (
                <Badge variant="outline">+{row.original.requirements.length - 2}</Badge>
              )}
            </div>
          ) : (
            <span className="text-xs text-warning-text" title="Not linked to any requirement">
              None
            </span>
          ),
      }),
      col.accessor((r) => r.tags.join(' '), {
        id: 'tags',
        header: 'Tags',
        cell: ({ row }) => (
          <div className="flex gap-1">
            {row.original.tags.slice(0, 3).map((t) => (
              <Badge key={t} variant="secondary">
                #{t}
              </Badge>
            ))}
          </div>
        ),
      }),
      col.accessor('stepCount', {
        id: 'stepCount',
        header: 'Steps',
        cell: (c) => <span className="tabular-nums">{c.getValue()}</span>,
      }),
      col.accessor('updatedAt', {
        id: 'updatedAt',
        header: 'Updated',
        cell: (c) => <span className="text-muted-foreground">{timeAgo(c.getValue())}</span>,
      }),
    ],
    [basePath, canWrite, canApprove, setStatusMutate, bulkMutate],
  );

  const grouping = view.groupBy === 'none' ? [] : [view.groupBy];
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (r) => r.id,
    state: {
      rowSelection: selection,
      grouping,
      expanded: true,
      columnVisibility: Object.fromEntries(
        columns.map((c) => [
          c.id!,
          c.id === 'select' ||
            (view.columns as string[]).includes(c.id!) ||
            (grouping as string[]).includes(c.id!),
        ]),
      ),
    },
    enableRowSelection: (row) => !row.getIsGrouped(),
    onRowSelectionChange: (u) => setSelection(typeof u === 'function' ? u(selection) : u),
    getCoreRowModel: getCoreRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    manualSorting: true,
    // Grouping is always fully expanded and data is server-driven: never auto-reset internal state
    // (an auto-reset on every data change can otherwise feed a render loop).
    autoResetAll: false,
    // Keep the user's column order when grouping (default would move the grouped column first).
    groupedColumnMode: false,
  });

  const sortBy = (id: string) => {
    const field = id === 'ref' ? 'seq' : (id as TestCaseViewState['sort']);
    setView({
      ...view,
      sort: field,
      dir: view.sort === field && view.dir === 'asc' ? 'desc' : 'asc',
    });
  };

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-background">
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id} className="hover:bg-transparent">
            {canWrite && <TableHead className="w-4 px-0" />}
            {hg.headers.map((h) => {
              const field = h.id === 'ref' ? 'seq' : h.id;
              const sorted = view.sort === field;
              return (
                <TableHead
                  key={h.id}
                  className={h.id === 'select' ? 'w-8' : undefined}
                  aria-sort={sorted ? (view.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {SORTABLE.has(h.id) ? (
                    <button
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => sortBy(h.id)}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {sorted &&
                        (view.dir === 'asc' ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        ))}
                    </button>
                  ) : (
                    flexRender(h.column.columnDef.header, h.getContext())
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => {
          if (row.getIsGrouped()) {
            const value = row.groupingValue as string;
            return (
              <TableRow key={row.id} className="bg-muted/40 hover:bg-muted/40">
                <TableCell
                  colSpan={row.getVisibleCells().length + (canWrite ? 1 : 0)}
                  className="py-1.5 text-xs font-semibold"
                >
                  <span className="inline-flex items-center gap-1">
                    <ChevronRight className="size-3 rotate-90" />{' '}
                    {view.groupBy === 'suite' ? value : humanize(value)}{' '}
                    <span className="font-normal text-muted-foreground">
                      ({row.subRows.length})
                    </span>
                  </span>
                </TableCell>
              </TableRow>
            );
          }
          const t = row.original;
          return (
            <TableRow
              key={row.id}
              data-state={row.getIsSelected() ? 'selected' : undefined}
              className={cn(t.status === 'DEPRECATED' && 'opacity-60')}
              draggable={canWrite}
              onDragStart={(e) => {
                const ids = row.getIsSelected() ? Object.keys(selection) : [t.id];
                e.dataTransfer.setData(TC_DRAG_TYPE, JSON.stringify(ids));
                e.dataTransfer.setData(
                  'text/plain',
                  ids.length > 1 ? `${ids.length} test cases` : t.ref,
                );
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              {canWrite && (
                <TableCell className="w-4 cursor-grab px-0 text-muted-foreground/50">
                  <GripVertical className="size-3.5" aria-hidden />
                </TableCell>
              )}
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function TestCaseCards({ rows, basePath }: { rows: TestCaseRow[]; basePath: string }) {
  return (
    <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((t) => (
        <Link
          key={t.id}
          href={`${basePath}/test-cases/${t.ref}`}
          className="rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <div className="flex items-center gap-2">
            <Ref>{t.ref}</Ref>
            <span className="ml-auto">
              <TestCaseStatusBadge status={t.status} />
            </span>
          </div>
          <p className="mt-2 line-clamp-2 font-medium">{t.title}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <PriorityLabel priority={t.priority} className="text-xs" />
            <span>· {t.stepCount} steps</span>
            {t.aiGenerated && <AiBadge confidence={t.aiConfidence} />}
            {t.requirements[0] && (
              <Badge variant="outline" className="font-mono">
                {t.requirements[0].ref}
              </Badge>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
