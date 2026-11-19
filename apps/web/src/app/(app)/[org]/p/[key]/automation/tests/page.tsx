'use client';
import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  FileCode2,
  Globe,
  History,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { testPathSchema, type AutomationTestStatus } from '@qaforge/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useAiAvailability } from '@/components/ai/ai-button';
import { CodeDiff, CodeEditor } from '@/components/automation/code-editor';
import { AutomationHeader, useAutomationBase } from '@/components/automation/shell';
import { useLatestJob, useStartAgentJob } from '@/hooks/ai';
import {
  useAutomationTest,
  useAutomationEnv,
  useAutomationTests,
  useDeleteTest,
  useResolveFix,
  useSaveTest,
  useStartRun,
  useTestVersion,
  type AutomationTestFull,
  type AutomationTestRow,
} from '@/hooks/automation';
import { useEnvironments, useTestCases } from '@/hooks/qa';
import { useCurrentProject } from '@/hooks/queries';
import { useHotkey } from '@/hooks/use-hotkey';
import { useCan } from '@/hooks/use-permission';
import { ApiError } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';

const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  {
    key: 'failing',
    label: 'Failing',
    test: (t: AutomationTestRow) => t.lastResult?.status === 'FAILED',
  },
  {
    key: 'flaky',
    label: 'Flaky',
    test: (t: AutomationTestRow) => t.flakyScore > 0 || !!t.lastResult?.flaky,
  },
  { key: 'fix', label: 'Fix ready', test: (t: AutomationTestRow) => t.hasPendingFix },
  {
    key: 'drafts',
    label: 'AI drafts',
    test: (t: AutomationTestRow) => t.tags.includes('ai-draft'),
  },
] as const;

const STATUS_DOT: Record<string, string> = {
  PASSED: 'bg-success',
  FAILED: 'bg-destructive',
  SKIPPED: 'bg-muted-foreground',
};

const TEMPLATE = `import { test, expect } from '@playwright/test';

test('describe what the user does', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/.+/);
});
`;

export default function UiTestsPage() {
  const { project } = useCurrentProject();
  const pid = project?.id;
  const canWrite = useCan('automation:write');
  const tests = useAutomationTests(pid);
  const [picked, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const envs = useEnvironments(pid);
  const [envId, setEnvId] = useAutomationEnv(pid, envs.data);

  const all = useMemo(() => tests.data ?? [], [tests.data]);
  const selected = picked ?? all[0]?.id ?? null;
  const visible = all.filter(
    (t) =>
      FILTERS.find((f) => f.key === filter)!.test(t) &&
      (!q || `${t.path} ${t.name} ${t.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div className="flex h-dvh flex-col">
      <AutomationHeader
        actions={
          <>
            <Select value={envId} onValueChange={setEnvId}>
              <SelectTrigger aria-label="Environment for runs" className="h-8 w-40 text-xs">
                <Globe className="size-3.5" />
                <SelectValue placeholder="No environment" />
              </SelectTrigger>
              <SelectContent>
                {envs.data?.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canWrite && (
              <>
                <Button size="sm" variant="outline" onClick={() => setGenerateOpen(true)}>
                  <Sparkles /> Generate from test case
                </Button>
                <Button size="sm" onClick={() => setNewOpen(true)}>
                  <Plus /> New test
                </Button>
              </>
            )}
          </>
        }
      />
      {tests.isError ? (
        <ErrorState error={tests.error} retry={() => tests.refetch()} what="UI tests" />
      ) : !tests.isPending && all.length === 0 ? (
        <EmptyState
          icon={FileCode2}
          title="No UI tests yet"
          description="Write Playwright tests in the browser, or let the Automation Agent draft one from a manual test case. Drafts stay disabled until you review them."
          action={
            canWrite && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setGenerateOpen(true)}>
                  <Sparkles /> Generate from test case
                </Button>
                <Button onClick={() => setNewOpen(true)}>
                  <Plus /> New test
                </Button>
              </div>
            )
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside
            aria-label="Tests"
            className="flex max-h-72 shrink-0 flex-col border-b bg-card md:max-h-none md:w-80 md:border-r md:border-b-0"
          >
            <div className="relative px-3 pt-3 pb-2">
              <Search
                className="absolute top-1/2 left-5.5 mt-0.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by path or tag"
                aria-label="Filter tests"
                className="h-8 pl-7 text-xs"
              />
            </div>
            <div role="tablist" aria-label="Show" className="flex flex-wrap gap-1 px-3 pb-2">
              {FILTERS.map((f) => {
                const n = all.filter(f.test).length;
                return (
                  <button
                    key={f.key}
                    role="tab"
                    aria-selected={filter === f.key}
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                      filter === f.key
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent/60',
                    )}
                  >
                    {f.label} {n}
                  </button>
                );
              })}
            </div>
            <ul className="min-h-0 flex-1 overflow-auto px-2 pb-3" aria-label="Test files">
              {tests.isPending
                ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="mx-1 my-1.5 h-7" />)
                : visible.map((t) => (
                    <li key={t.id}>
                      <button
                        onClick={() => setSelected(t.id)}
                        aria-current={selected === t.id ? 'true' : undefined}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
                          selected === t.id ? 'bg-accent' : 'hover:bg-accent/60',
                        )}
                      >
                        <span
                          className={cn(
                            'size-2 shrink-0 rounded-full',
                            t.status !== 'ACTIVE'
                              ? 'bg-border'
                              : (STATUS_DOT[t.lastResult?.status ?? ''] ?? 'bg-border'),
                          )}
                          aria-hidden
                        />
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate font-mono text-[12px]',
                            t.status === 'DISABLED' && 'text-muted-foreground',
                          )}
                        >
                          {t.path}
                        </span>
                        {t.hasPendingFix ? (
                          <span className="rounded-full bg-primary-subtle px-1.5 text-[10.5px] font-semibold text-primary">
                            Fix ready
                          </span>
                        ) : t.status === 'QUARANTINED' ? (
                          <span className="rounded-full bg-muted px-1.5 text-[10.5px] font-semibold text-muted-foreground">
                            Quarantined
                          </span>
                        ) : t.tags.includes('ai-draft') ? (
                          <span className="rounded-full bg-primary-subtle px-1.5 text-[10.5px] font-semibold text-primary">
                            AI draft
                          </span>
                        ) : t.flakyScore > 0 ? (
                          <span className="rounded-full bg-warning-subtle px-1.5 text-[10.5px] font-semibold text-warning-text">
                            Flaky {t.flakyScore.toFixed(1)}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
              {!tests.isPending && visible.length === 0 && (
                <li className="px-2 py-6 text-center text-xs text-muted-foreground">
                  No tests match.
                </li>
              )}
            </ul>
          </aside>
          <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4 lg:p-5">
            {selected && pid ? (
              <TestEditor
                key={selected}
                id={selected}
                projectId={pid}
                envId={envId || null}
                canWrite={canWrite}
                onDeleted={() => setSelected(null)}
              />
            ) : (
              <Skeleton className="h-10" />
            )}
          </main>
        </div>
      )}
      {pid && (
        <NewTestDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          projectId={pid}
          onCreated={(id) => setSelected(id)}
        />
      )}
      {pid && <GenerateDialog open={generateOpen} onOpenChange={setGenerateOpen} projectId={pid} />}
    </div>
  );
}

// ---- editor ------------------------------------------------------------------------------------

function TestEditor({
  id,
  projectId,
  envId,
  canWrite,
  onDeleted,
}: {
  id: string;
  projectId: string;
  envId: string | null;
  canWrite: boolean;
  onDeleted: () => void;
}) {
  const test = useAutomationTest(projectId, id);
  const canRun = useCan('automation:run');
  const [code, setCode] = useState<string | null>(null);
  // The version the editor is based on; saving sends it so a concurrent edit returns 409.
  const [loaded, setLoaded] = useState<{ code: string; version: number } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conflict, setConflict] = useState(false);
  const save = useSaveTest(projectId);
  const del = useDeleteTest(projectId);
  const start = useStartRun(projectId);
  const router = useRouter();
  const base = useAutomationBase();

  const t = test.data;
  // First load, and reload when a new version arrives (e.g. an approved AI fix) while the
  // editor has no unsaved changes.
  if (t && (!loaded || (t.version !== loaded.version && code === loaded.code))) {
    setCode(t.code);
    setLoaded({ code: t.code, version: t.version });
  }
  const dirty = !!loaded && code !== null && code !== loaded.code;
  const baseVersion = loaded?.version;

  const doSave = useCallback(() => {
    if (!t || code === null || !dirty || !canWrite) return;
    save.mutate(
      { id, code, version: baseVersion },
      {
        onSuccess: (r) => {
          setLoaded({ code: r.code, version: r.version });
          setConflict(false);
          toast.success(`Saved as v${r.version}`);
        },
        onError: (e) => {
          if (e instanceof ApiError && e.status === 409) setConflict(true);
          else toast.error(e.message);
        },
      },
    );
  }, [t, code, dirty, canWrite, save, id, baseVersion]);
  useHotkey('mod+s', doSave, canWrite);

  if (test.isError)
    return <ErrorState error={test.error} retry={() => test.refetch()} what="this test" />;
  if (!t || code === null)
    return (
      <div className="grid gap-3">
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-96" />
      </div>
    );

  const setStatus = (status: AutomationTestStatus) =>
    save.mutate(
      { id, status },
      {
        onSuccess: () =>
          toast.success(
            status === 'ACTIVE'
              ? 'Test enabled'
              : status === 'QUARANTINED'
                ? 'Test quarantined: it runs but can’t fail the run'
                : 'Test disabled',
          ),
        onError: (e) => toast.error(e.message),
      },
    );
  const run = () =>
    start.mutate(
      { selection: { kind: 'tests', testIds: [id] }, environmentId: envId, retries: 1 },
      { onSuccess: (r) => router.push(`${base}/runs/${r.ref}`) },
    );

  return (
    <>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-mono text-[15px] font-semibold">{t.path}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusPill status={t.status} />
            <span>v{t.version}</span>
            {t.testCase && <span>· linked to TC-{t.testCase.seq}</span>}
            <span>· flaky score {t.flakyScore.toFixed(1)}</span>
            {t.tags.map((tag) => (
              <span key={tag} className="rounded bg-muted px-1.5 py-px text-[11px]">
                {tag}
              </span>
            ))}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
          <History /> History
        </Button>
        {canRun && (
          <Button
            variant="outline"
            size="sm"
            onClick={run}
            disabled={start.isPending || t.status === 'DISABLED' || dirty}
            title={
              t.status === 'DISABLED'
                ? 'Enable the test to run it'
                : dirty
                  ? 'Save first'
                  : undefined
            }
          >
            <Play /> Run
          </Button>
        )}
        {canWrite && (
          <>
            <Button size="sm" onClick={doSave} disabled={!dirty || save.isPending}>
              {save.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Test actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {t.status !== 'ACTIVE' && (
                  <DropdownMenuItem onSelect={() => setStatus('ACTIVE')}>Enable</DropdownMenuItem>
                )}
                {t.status !== 'QUARANTINED' && (
                  <DropdownMenuItem onSelect={() => setStatus('QUARANTINED')}>
                    Quarantine
                  </DropdownMenuItem>
                )}
                {t.status !== 'DISABLED' && (
                  <DropdownMenuItem onSelect={() => setStatus('DISABLED')}>
                    Disable
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    if (confirm(`Delete ${t.path}? Its history is kept in the audit log.`))
                      del.mutate(id, { onSuccess: onDeleted });
                  }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {t.tags.includes('ai-draft') && t.status === 'DISABLED' && (
        <p className="rounded-lg border border-primary/30 bg-primary-subtle/60 px-3 py-2 text-sm">
          <Sparkles className="mr-1.5 inline size-4 text-primary" aria-hidden />
          Drafted by the Automation Agent. Review the code, run it once, then enable it from the
          menu.
        </p>
      )}

      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-lg bg-warning-subtle px-3 py-2 text-sm text-warning-text"
        >
          Someone saved a newer version (v{t.version}) while you were editing.
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCode(t.code);
              setLoaded({ code: t.code, version: t.version });
              setConflict(false);
            }}
          >
            Discard mine and load v{t.version}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setLoaded({ code: t.code, version: t.version });
              setConflict(false);
            }}
          >
            Keep mine (overwrite on save)
          </Button>
        </div>
      )}

      {t.pendingFix && <PendingFixCard test={t} projectId={projectId} canWrite={canWrite} />}

      <section
        aria-label="Code"
        className="flex min-h-80 flex-1 flex-col overflow-hidden rounded-xl border bg-card"
      >
        <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
          <FileCode2 className="size-3.5" aria-hidden />
          TypeScript · Playwright
          <span className="ml-auto">
            {dirty ? 'Unsaved changes · Ctrl+S to save' : `Updated ${timeAgo(t.updatedAt)}`}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <CodeEditor
            label={`Code for ${t.path}`}
            path={`file:///tests/${t.path}`}
            value={code}
            onChange={setCode}
            readOnly={!canWrite}
          />
        </div>
      </section>
      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        test={t}
        projectId={projectId}
        current={code}
      />
    </>
  );
}

function StatusPill({ status }: { status: AutomationTestStatus }) {
  const [label, cls] =
    status === 'ACTIVE'
      ? ['Enabled', 'bg-success-subtle text-success-text']
      : status === 'QUARANTINED'
        ? ['Quarantined', 'bg-warning-subtle text-warning-text']
        : ['Disabled', 'bg-muted text-muted-foreground'];
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', cls)}>{label}</span>
  );
}

/** The repair agent's suggestion: shown as a diff, applied only when a person approves it. */
function PendingFixCard({
  test,
  projectId,
  canWrite,
}: {
  test: AutomationTestFull;
  projectId: string;
  canWrite: boolean;
}) {
  const fix = test.pendingFix!;
  const resolve = useResolveFix(projectId, test.id);
  const stale = fix.baseVersion !== undefined && fix.baseVersion !== test.version;
  return (
    <section
      aria-label="Suggested fix"
      className="overflow-hidden rounded-xl border border-primary/50 bg-card"
    >
      <div className="flex flex-wrap items-start gap-3 bg-primary-subtle/70 px-4 py-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Automation Agent suggests a fix</h2>
          <p className="text-xs text-muted-foreground">
            {fix.summary ?? 'A locator or wait changed.'}
            {fix.confidence !== undefined && ` Confidence ${fix.confidence.toFixed(2)}.`} Assertions
            are kept.
            {stale && ' The test changed since this was suggested; check the diff carefully.'}
          </p>
          {!!fix.changes?.length && (
            <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
              {fix.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => resolve.mutate('dismiss')}
              disabled={resolve.isPending}
            >
              <X /> Dismiss
            </Button>
            <Button
              size="sm"
              onClick={() => resolve.mutate('approve')}
              disabled={resolve.isPending}
            >
              <Check /> Approve fix
            </Button>
          </div>
        )}
      </div>
      <CodeDiff original={test.code} modified={fix.code} label="Suggested fix" height={220} />
    </section>
  );
}

function HistoryDialog({
  open,
  onOpenChange,
  test,
  projectId,
  current,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  test: AutomationTestFull;
  projectId: string;
  current: string;
}) {
  const [version, setVersion] = useState<number | null>(null);
  const v = useTestVersion(projectId, test.id, open ? version : null);
  const REASON: Record<string, string> = {
    edit: 'Edited',
    ai_generate: 'Drafted by AI',
    ai_repair: 'AI fix approved',
    create: 'Created',
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>History · {test.path}</DialogTitle>
          <DialogDescription>Pick a version to compare it with the editor.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-[200px_1fr]">
          <ul className="max-h-96 overflow-auto" aria-label="Versions">
            {test.versions.map((x) => (
              <li key={x.version}>
                <button
                  onClick={() => setVersion(x.version)}
                  aria-current={version === x.version ? 'true' : undefined}
                  className={cn(
                    'w-full rounded-md px-2 py-1.5 text-left text-sm',
                    version === x.version ? 'bg-accent' : 'hover:bg-accent/60',
                  )}
                >
                  <span className="font-semibold">v{x.version}</span>{' '}
                  <span className="text-xs text-muted-foreground">
                    {REASON[x.reason] ?? x.reason}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {timeAgo(x.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-h-64 overflow-hidden rounded-lg border">
            {!version ? (
              <p className="p-6 text-sm text-muted-foreground">Select a version.</p>
            ) : v.isPending ? (
              <Skeleton className="m-3 h-40" />
            ) : v.data ? (
              <CodeDiff
                original={v.data.code}
                modified={current}
                label={`v${version} compared with the editor`}
                height={380}
              />
            ) : (
              <ErrorState error={v.error} what="this version" />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewTestDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const save = useSaveTest(projectId);
  const pathError = path ? testPathSchema.safeParse(path).error?.issues[0]?.message : undefined;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(
              {
                name,
                path: path || `${slug}.spec.ts`,
                code: TEMPLATE.replace('describe what the user does', name),
                status: 'ACTIVE',
              },
              {
                onSuccess: (t) => {
                  onCreated(t.id);
                  onOpenChange(false);
                  setName('');
                  setPath('');
                },
                onError: (err) => toast.error(err.message),
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>New UI test</DialogTitle>
            <DialogDescription>
              One Playwright file. Use folders to group tests, e.g. checkout/pay.spec.ts.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-sm font-medium">
            Name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              placeholder="Guest can pay with a card"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            File path
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={slug ? `${slug}.spec.ts` : 'checkout/pay.spec.ts'}
              className="font-mono"
              aria-invalid={!!pathError}
              aria-describedby="path-error"
            />
            {pathError && (
              <span id="path-error" className="text-xs font-normal text-destructive-text">
                {pathError}
              </span>
            )}
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !!pathError || save.isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Pick a manual test case; the Automation Agent drafts a disabled page-object test from it. */
function GenerateDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [envId, setEnvId] = useState('');
  const avail = useAiAvailability('automation');
  const envs = useEnvironments(projectId);
  const cases = useTestCases(
    open ? projectId : undefined,
    new URLSearchParams({ q, pageSize: '20', status: 'APPROVED,IN_REVIEW,DRAFT' }).toString(),
  );
  const start = useStartAgentJob(projectId);
  const job = useLatestJob(projectId, picked ?? undefined, 'generate-ui-test');
  const running = job && (job.status === 'QUEUED' || job.status === 'RUNNING');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Generate a UI test</DialogTitle>
          <DialogDescription>
            The Automation Agent turns a manual test case into a Playwright test with page objects.
            It sees the steps and the environment’s base URL, never its secrets. The draft is saved
            disabled for your review.
          </DialogDescription>
        </DialogHeader>
        {!avail.ok ? (
          <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{avail.reason}</p>
        ) : (
          <>
            <div className="relative">
              <Search
                className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search test cases"
                aria-label="Search test cases"
                className="pl-8"
              />
            </div>
            <ul
              role="listbox"
              aria-label="Test cases"
              className="max-h-64 overflow-auto rounded-lg border"
            >
              {cases.isPending ? (
                <li className="p-3">
                  <Skeleton className="h-6" />
                </li>
              ) : cases.isError ? (
                <li>
                  <ErrorState error={cases.error} what="test cases" />
                </li>
              ) : cases.data?.items.length === 0 ? (
                <li className="p-4 text-center text-sm text-muted-foreground">
                  No test cases match.
                </li>
              ) : (
                cases.data?.items.map((c) => (
                  <li
                    key={c.id}
                    role="option"
                    aria-selected={picked === c.id}
                    tabIndex={0}
                    onClick={() => setPicked(c.id)}
                    onKeyDown={(e) =>
                      (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setPicked(c.id))
                    }
                    className={cn(
                      'flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0',
                      picked === c.id ? 'bg-primary-subtle' : 'hover:bg-accent',
                    )}
                  >
                    <span className="font-mono text-xs text-muted-foreground">{c.ref}</span>
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    {c.automationStatus === 'AUTOMATED' && (
                      <span className="text-[11px] text-muted-foreground">automated</span>
                    )}
                  </li>
                ))
              )}
            </ul>
            <label className="grid gap-1 text-sm font-medium">
              Environment (for the base URL)
              <select
                value={envId}
                onChange={(e) => setEnvId(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">None</option>
                {envs.data?.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={!avail.ok || !picked || start.isPending || !!running}
            onClick={() =>
              start.mutate(
                {
                  kind: 'generate-ui-test',
                  testCaseId: picked!,
                  ...(envId ? { environmentId: envId } : {}),
                },
                {
                  onSuccess: () =>
                    toast.success('Drafting the test. You’ll get a notification when it’s ready.'),
                },
              )
            }
          >
            {running ? (
              <>
                <Loader2 className="animate-spin" /> {job?.progressMessage ?? 'Working'}
              </>
            ) : (
              <>
                <Sparkles /> Generate
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
