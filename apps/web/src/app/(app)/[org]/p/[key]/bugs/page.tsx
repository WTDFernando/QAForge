'use client';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Bug, LayoutGrid, List, Plus, Search, Sparkles } from 'lucide-react';
import { BUG_SEVERITIES, humanize, type BugSeverity } from '@qaforge/shared';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FacetFilter } from '@/components/ui/facet-filter';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { PageHeader } from '@/components/shell/page-header';
import { useCreateAction } from '@/components/shell/ui-state';
import { BugBoard } from '@/components/bugs/bug-board';
import { BugFormDialog } from '@/components/bugs/bug-form-dialog';
import { QuickReportDialog } from '@/components/bugs/quick-report-dialog';
import { BUG_STATUS_DOT, SeverityBadge } from '@/components/qa/run-status';
import { useAiSettings } from '@/hooks/ai';
import { useBugBoard, useBugComponents } from '@/hooks/bugs';
import { useCurrentProject, useMembers } from '@/hooks/queries';
import { useHotkey } from '@/hooks/use-hotkey';
import { useCan } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';

export default function BugsPage() {
  const { project, org } = useCurrentProject();
  const canWrite = useCan('bug:write');
  const canUseAi = useCan('ai:use');
  const ai = useAiSettings(org?.id);
  const members = useMembers(org?.id);
  const components = useBugComponents(project?.id);
  const [view, setView] = useState<'board' | 'table'>(() => {
    try {
      return localStorage.getItem('qaforge:bugs-view') === 'table' ? 'table' : 'board';
    } catch {
      return 'board';
    }
  });
  const [q, setQ] = useState('');
  const [severity, setSeverity] = useState<BugSeverity[]>([]);
  const [component, setComponent] = useState<string[]>([]);
  const [mine, setMine] = useState(false);
  const [openOnly, setOpenOnly] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useHotkey('/', () => searchRef.current?.focus());
  useCreateAction('New bug', canWrite ? () => setNewOpen(true) : null);

  const qs = new URLSearchParams({
    ...(q.trim() && { q: q.trim() }),
    ...(severity.length && { severity: severity.join(',') }),
    ...(component.length === 1 && { component: component[0]! }),
    ...(mine && { assigneeId: 'me' }),
  }).toString();
  const board = useBugBoard(project?.id, qs);
  const bugs = useMemo(
    () =>
      (board.data ?? []).filter(
        (b) =>
          (!openOnly || b.status !== 'CLOSED') &&
          (component.length <= 1 || (b.component && component.includes(b.component))),
      ),
    [board.data, openOnly, component],
  );
  const people = useMemo(
    () => new Map(members.data?.map((m) => [m.user.id, m.user]) ?? []),
    [members.data],
  );
  const base = project && org ? `/${org.slug}/p/${project.key}` : '';
  const openCount = (board.data ?? []).filter((b) => b.status !== 'CLOSED').length;
  const switchView = (v: 'board' | 'table') => {
    setView(v);
    try {
      localStorage.setItem('qaforge:bugs-view', v);
    } catch {}
  };
  const filtered = !!(q || severity.length || component.length || mine);

  return (
    <div className="flex h-dvh flex-col">
      <PageHeader
        breadcrumb={project?.name}
        title={
          <span className="flex items-center gap-2">
            Bugs
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {openCount} open
            </span>
          </span>
        }
        description={
          view === 'board'
            ? 'Drag cards between columns, or focus a card and press 1–5 to move it.'
            : undefined
        }
        actions={
          canWrite && (
            <>
              {canUseAi && (
                <Button variant="outline" onClick={() => setQuickOpen(true)} disabled={!project}>
                  <Sparkles className="text-primary" /> Quick report
                </Button>
              )}
              <Button onClick={() => setNewOpen(true)} disabled={!project}>
                <Plus /> New bug
              </Button>
            </>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2 px-6 pb-4 lg:px-8">
        <div
          role="radiogroup"
          aria-label="View"
          className="flex gap-0.5 rounded-lg bg-muted p-[3px]"
        >
          {(
            [
              ['board', 'Board', LayoutGrid],
              ['table', 'Table', List],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              role="radio"
              aria-checked={view === v}
              onClick={() => switchView(v)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium',
                view === v
                  ? 'bg-card font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" aria-hidden /> {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search bugs"
            aria-label="Search bugs"
            className="h-8 w-60 pr-8 pl-8"
          />
          <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
        </div>
        <FacetFilter
          label="Severity"
          options={BUG_SEVERITIES.map((s) => ({ value: s, label: humanize(s) }))}
          value={severity}
          onChange={setSeverity}
        />
        {(components.data?.length ?? 0) > 0 && (
          <FacetFilter
            label="Component"
            options={components.data!.map((c) => ({ value: c.component, label: c.component }))}
            counts={Object.fromEntries(components.data!.map((c) => [c.component, c.count]))}
            value={component}
            onChange={setComponent}
          />
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={mine} onCheckedChange={(c) => setMine(c === true)} /> Assigned to me
        </label>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <Checkbox checked={openOnly} onCheckedChange={(c) => setOpenOnly(c === true)} /> Open only
        </label>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-6 lg:px-8">
        {board.isError ? (
          <ErrorState error={board.error} retry={() => board.refetch()} what="bugs" />
        ) : board.isPending ? (
          <div className="grid grid-cols-5 gap-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-72 rounded-xl" />
            ))}
          </div>
        ) : !filtered && (board.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={Bug}
            title="No bugs yet"
            description="Report one from a failed test step, write one yourself, or let the Bug Agent draft it from a screenshot."
            action={
              canWrite && (
                <div className="flex gap-2">
                  {canUseAi && (
                    <Button variant="outline" onClick={() => setQuickOpen(true)}>
                      <Sparkles /> Quick report
                    </Button>
                  )}
                  <Button onClick={() => setNewOpen(true)}>
                    <Plus /> New bug
                  </Button>
                </div>
              )
            }
          />
        ) : view === 'board' ? (
          <BugBoard
            bugs={bugs}
            projectId={project!.id}
            base={base}
            people={people}
            canWrite={canWrite}
          />
        ) : bugs.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No bugs match"
            description="Clear a filter or search for something else."
          />
        ) : (
          <div className="mb-6 overflow-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2 font-semibold">Bug</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Severity</th>
                  <th className="hidden px-4 py-2 font-semibold md:table-cell">Component</th>
                  <th className="hidden px-4 py-2 font-semibold md:table-cell">Assignee</th>
                  <th className="hidden px-4 py-2 font-semibold lg:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody>
                {bugs.map((b) => {
                  const who = b.assigneeId ? people.get(b.assigneeId) : undefined;
                  return (
                    <tr key={b.id} className="border-t hover:bg-accent/40">
                      <td className="px-4 py-2.5">
                        <span className="mr-2 font-mono text-[11px] text-muted-foreground">
                          {b.ref}
                        </span>
                        <Link
                          href={`${base}/bugs/${b.ref}`}
                          className="font-medium hover:underline"
                        >
                          {b.title}
                        </Link>
                        {b.aiGenerated && (
                          <Sparkles
                            className="ml-1.5 inline size-3.5 text-primary"
                            aria-label="AI-assisted"
                          />
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={cn('size-2 rounded-full', BUG_STATUS_DOT[b.status])}
                            aria-hidden
                          />
                          {humanize(b.status)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <SeverityBadge severity={b.severity} />
                      </td>
                      <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">
                        {b.component ?? '—'}
                      </td>
                      <td className="hidden px-4 py-2.5 md:table-cell">
                        {who ? (
                          <span className="flex items-center gap-2">
                            <Avatar name={who.name} src={who.image} className="size-5" />
                            {who.name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Unassigned</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-2.5 text-xs text-muted-foreground lg:table-cell">
                        {new Date(b.updatedAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {project && (
        <>
          <BugFormDialog
            open={newOpen}
            onOpenChange={setNewOpen}
            projectId={project.id}
            basePath={base}
          />
          <QuickReportDialog
            open={quickOpen}
            onOpenChange={setQuickOpen}
            projectId={project.id}
            basePath={base}
            aiReady={!!ai.data?.ready}
          />
        </>
      )}
    </div>
  );
}
