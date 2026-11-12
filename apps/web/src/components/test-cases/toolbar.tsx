'use client';
import { useState } from 'react';
import {
  Bookmark,
  Columns3,
  Download,
  LayoutGrid,
  Rows3,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AUTOMATION_STATUSES,
  humanize,
  PRIORITIES,
  TEST_CASE_STATUSES,
  TEST_CASE_TYPES,
} from '@qaforge/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FacetFilter } from '@/components/ui/facet-filter';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSavedViewMutations, useSavedViews, useTags } from '@/hooks/qa';
import { useMe } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';
import { download } from '@/lib/api';
import {
  activeFilterCount,
  DEFAULT_VIEW,
  GROUP_BY,
  normalizeView,
  REVIEW_VIEW,
  TC_COLUMNS,
  toQueryString,
  type TestCaseViewState,
} from '@/lib/test-case-view';

const opts = <T extends string>(values: readonly T[]) =>
  values.map((v) => ({ value: v, label: humanize(v) }));

export function TestCaseToolbar({
  projectId,
  view,
  setView,
  suiteId,
  searchRef,
}: {
  projectId: string;
  view: TestCaseViewState;
  setView: (v: TestCaseViewState) => void;
  suiteId?: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const patch = (p: Partial<TestCaseViewState>) => setView({ ...view, ...p });
  const tags = useTags(projectId);
  const views = useSavedViews(projectId, 'test_case');
  const viewMut = useSavedViewMutations(projectId, 'test_case');
  const { data: me } = useMe();
  const canShare = useCan('testcase:write');
  const [viewName, setViewName] = useState('');
  const [shareView, setShareView] = useState(false);
  const isReview = JSON.stringify(view.status) === JSON.stringify(REVIEW_VIEW.status);
  const filters = activeFilterCount(view);

  const saveView = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!viewName.trim()) return;
    await viewMut.create.mutateAsync({
      name: viewName.trim(),
      config: view as unknown as Record<string, unknown>,
      shared: shareView,
    });
    toast.success(`View "${viewName.trim()}" saved`);
    setViewName('');
    setShareView(false);
  };

  const exportAs = (format: 'csv' | 'xlsx') =>
    toast.promise(
      download(
        `/v1/projects/${projectId}/test-cases/export?${toQueryString(view, { suiteId })}&format=${format}`,
        `test-cases.${format}`,
      ),
      {
        loading: 'Preparing export…',
        success: 'Export ready',
        error: (e) => (e instanceof Error ? e.message : 'Export failed'),
      },
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={view.q}
          onChange={(e) => patch({ q: e.target.value })}
          placeholder="Search title, TC-id or tag…  /"
          className="h-8 pl-8"
          aria-label="Search test cases"
        />
      </div>
      <Button
        size="sm"
        variant={isReview ? 'default' : 'outline'}
        onClick={() =>
          setView(isReview ? { ...view, status: [] } : { ...view, status: REVIEW_VIEW.status })
        }
        aria-pressed={isReview}
      >
        <Sparkles /> Review queue
      </Button>
      <FacetFilter
        label="Status"
        options={opts(TEST_CASE_STATUSES)}
        value={view.status}
        onChange={(status) => patch({ status })}
      />
      <FacetFilter
        label="Priority"
        options={opts(PRIORITIES)}
        value={view.priority}
        onChange={(priority) => patch({ priority })}
      />
      <FacetFilter
        label="Type"
        options={opts(TEST_CASE_TYPES)}
        value={view.type}
        onChange={(type) => patch({ type })}
      />
      <FacetFilter
        label="Automation"
        options={opts(AUTOMATION_STATUSES)}
        value={view.automationStatus}
        onChange={(automationStatus) => patch({ automationStatus })}
      />
      {!!tags.data?.length && (
        <Select
          value={view.tag || '__all'}
          onValueChange={(t) => patch({ tag: t === '__all' ? '' : t })}
        >
          <SelectTrigger size="sm" className="h-8 border-dashed" aria-label="Tag filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Any tag</SelectItem>
            {tags.data.map((t) => (
              <SelectItem key={t.tag} value={t.tag}>
                #{t.tag} ({t.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {filters > 0 && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setView({
              ...view,
              q: '',
              status: [],
              priority: [],
              type: [],
              automationStatus: [],
              tag: '',
              aiGenerated: null,
            })
          }
        >
          Reset <X />
        </Button>
      )}

      <div className="ml-auto flex items-center gap-1">
        <Select
          value={view.groupBy}
          onValueChange={(g) => patch({ groupBy: g as TestCaseViewState['groupBy'] })}
        >
          <SelectTrigger size="sm" className="h-8" aria-label="Group by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUP_BY.map((g) => (
              <SelectItem key={g} value={g}>
                {g === 'none' ? 'No grouping' : `Group: ${humanize(g)}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="outline" aria-label="Choose columns">
              <Columns3 />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Columns</DropdownMenuLabel>
            {TC_COLUMNS.map((c) => (
              <DropdownMenuCheckItem
                key={c.id}
                checked={view.columns.includes(c.id)}
                disabled={'required' in c}
                onSelect={(e) => {
                  e.preventDefault();
                  patch({
                    columns: view.columns.includes(c.id)
                      ? view.columns.filter((x) => x !== c.id)
                      : TC_COLUMNS.map((x) => x.id).filter(
                          (x) => x === c.id || view.columns.includes(x),
                        ),
                  });
                }}
              >
                {c.label}
              </DropdownMenuCheckItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={view.layout === 'table' ? 'Card view' : 'Table view'}
          onClick={() => patch({ layout: view.layout === 'table' ? 'cards' : 'table' })}
        >
          {view.layout === 'table' ? <LayoutGrid /> : <Rows3 />}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-8">
              <Bookmark /> Views
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-2">
            <div className="grid gap-0.5">
              <button
                className="rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => setView(DEFAULT_VIEW)}
              >
                All test cases (default)
              </button>
              <button
                className="rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => setView(REVIEW_VIEW)}
              >
                Review queue
              </button>
              {views.data?.map((v) => (
                <div key={v.id} className="group flex items-center rounded hover:bg-accent">
                  <button
                    className="flex-1 px-2 py-1.5 text-left text-sm"
                    onClick={() => setView(normalizeView(v.config))}
                  >
                    {v.name}{' '}
                    {v.shared && <span className="text-xs text-muted-foreground">· shared</span>}
                  </button>
                  {v.ownerId === me?.user.id && (
                    <button
                      className="p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                      aria-label={`Delete view ${v.name}`}
                      onClick={() => viewMut.remove.mutate(v.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <form onSubmit={saveView} className="mt-2 grid gap-2 border-t pt-2">
              <Input
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="Save current view as…"
                className="h-8"
                aria-label="View name"
              />
              <div className="flex items-center justify-between">
                {canShare ? (
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={shareView}
                      onCheckedChange={(c) => setShareView(c === true)}
                    />{' '}
                    Share with project
                  </label>
                ) : (
                  <span />
                )}
                <Button size="sm" type="submit" disabled={!viewName.trim()}>
                  Save
                </Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-8">
              <Download /> Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Export {filters ? 'filtered' : 'all'} test cases</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => exportAs('csv')}>CSV</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportAs('xlsx')}>Excel (.xlsx)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
