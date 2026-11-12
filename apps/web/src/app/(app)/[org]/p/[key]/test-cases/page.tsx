'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { RowSelectionState } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, ClipboardCheck, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shell/page-header';
import { useCreateAction } from '@/components/shell/ui-state';
import { BulkBar } from '@/components/test-cases/bulk-bar';
import { CreateTestCaseDialog } from '@/components/test-cases/create-test-case-dialog';
import { SuiteTree } from '@/components/test-cases/suite-tree';
import { TestCaseCards, TestCaseTable } from '@/components/test-cases/test-case-table';
import { TestCaseToolbar } from '@/components/test-cases/toolbar';
import { useCurrentProject } from '@/hooks/queries';
import { useSuites, useTestCases } from '@/hooks/qa';
import { useHotkey } from '@/hooks/use-hotkey';
import { useCan } from '@/hooks/use-permission';
import {
  activeFilterCount,
  DEFAULT_VIEW,
  normalizeView,
  REVIEW_VIEW,
  toQueryString,
  type TestCaseViewState,
} from '@/lib/test-case-view';

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const storageKey = (pid: string) => `qaforge:tc-view:${pid}`;

/** Last-used view per project (browser-local convenience); ?view=review opens the review queue. */
function initialView(projectId: string, review: boolean): TestCaseViewState {
  if (review) return REVIEW_VIEW;
  try {
    const saved = localStorage.getItem(storageKey(projectId));
    if (saved) return normalizeView(JSON.parse(saved));
  } catch {}
  return DEFAULT_VIEW;
}

export default function TestCasesPage() {
  const { project, org } = useCurrentProject();
  const review = useSearchParams().get('view') === 'review';
  if (!project || !org)
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-64" />
      </div>
    );
  return (
    <TestCasesWorkspace key={`${project.id}:${review}`} projectId={project.id} review={review} />
  );
}

function TestCasesWorkspace({ projectId, review }: { projectId: string; review: boolean }) {
  const { project, org } = useCurrentProject();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const suiteId = params.get('suite') ?? undefined;
  const canWrite = useCan('testcase:write');
  const suites = useSuites(projectId);

  const [view, setViewState] = useState<TestCaseViewState>(() => initialView(projectId, review));
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [createOpen, setCreateOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const setView = useCallback(
    (v: TestCaseViewState) => {
      setViewState(v);
      setPage(1);
      setSelection({});
      try {
        if (project) localStorage.setItem(storageKey(project.id), JSON.stringify(v));
      } catch {}
    },
    [project],
  );

  const debouncedQ = useDebounced(view.q);
  const qs = useMemo(
    () => toQueryString({ ...view, q: debouncedQ }, { suiteId, page }),
    [view, debouncedQ, suiteId, page],
  );
  const list = useTestCases(project?.id, qs);

  useCreateAction('New test case', canWrite ? () => setCreateOpen(true) : null);
  useHotkey(
    '/',
    useCallback(() => searchRef.current?.focus(), []),
  );

  if (!project || !org)
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-64" />
      </div>
    );
  const basePath = `/${org.slug}/p/${project.key}`;
  const selectSuite = (id?: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('suite', id);
    else next.delete('suite');
    next.delete('view');
    setPage(1);
    setSelection({});
    router.replace(`${pathname}?${next}`);
  };
  const suiteName =
    suiteId === 'none' ? 'Unsorted' : suites.data?.suites.find((s) => s.id === suiteId)?.name;
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const nothingAtAll = data?.total === 0 && activeFilterCount(view) === 0 && !suiteId;
  const selectedIds = Object.keys(selection).filter((k) => selection[k]);

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            {project.name} / <span className="text-foreground">Test cases</span>
          </>
        }
        title={suiteName ?? 'Test cases'}
        description="Your test case repository. Drag rows onto a suite to move them."
        actions={
          canWrite && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> New test case
            </Button>
          )
        }
      />
      <div className="flex min-h-0 flex-1 border-t lg:mx-8 lg:mb-8 lg:rounded-xl lg:border">
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r md:block">
          <SuiteTree
            projectId={project.id}
            selected={suiteId}
            onSelect={selectSuite}
            canEdit={canWrite}
          />
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="border-b p-3">
            <TestCaseToolbar
              projectId={project.id}
              view={view}
              setView={setView}
              suiteId={suiteId}
              searchRef={searchRef}
            />
          </div>
          <div className="relative min-h-64 flex-1 overflow-auto" aria-busy={list.isFetching}>
            {list.isLoading ? (
              <div className="grid gap-2 p-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-9" />
                ))}
              </div>
            ) : nothingAtAll ? (
              <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-12 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <ClipboardCheck />
                </div>
                <h2 className="font-semibold">No test cases yet</h2>
                <p className="text-sm text-muted-foreground">
                  Write your first test case, or open a requirement and add test cases from it so
                  coverage is tracked automatically. AI-generated drafts arrive in Phase 3.
                </p>
                {canWrite && (
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus /> New test case
                  </Button>
                )}
              </div>
            ) : data?.items.length === 0 ? (
              <p className="p-12 text-center text-sm text-muted-foreground">
                No test cases match these filters.
              </p>
            ) : view.layout === 'cards' ? (
              <TestCaseCards rows={data?.items ?? []} basePath={basePath} />
            ) : (
              <TestCaseTable
                projectId={project.id}
                rows={data?.items ?? []}
                basePath={basePath}
                view={view}
                setView={setView}
                selection={selection}
                setSelection={setSelection}
                role={org.role}
              />
            )}
            <BulkBar projectId={project.id} ids={selectedIds} onClear={() => setSelection({})} />
          </div>
          {data && data.total > 0 && (
            <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
              <span>
                {(data.page - 1) * data.pageSize + 1}–
                {Math.min(data.page * data.pageSize, data.total)} of {data.total}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft />
                </Button>
                <span className="tabular-nums">
                  {page} / {pages}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
      <CreateTestCaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={project.id}
        basePath={basePath}
        suiteId={suiteId}
      />
    </>
  );
}
