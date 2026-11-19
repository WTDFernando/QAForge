'use client';
import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronRight,
  Globe,
  MoreHorizontal,
  Network,
  Play,
  Plus,
  Search,
  Send,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  HTTP_METHODS,
  type ApiAuth,
  type ApiRequestInput,
  type HttpMethod,
  type KeyValue,
} from '@qaforge/shared';
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
import { ImportDialog } from '@/components/automation/import-dialog';
import {
  AssertionsEditor,
  AuthEditor,
  BodyEditor,
  ExtractEditor,
  KeyValueTable,
  ResponseView,
} from '@/components/automation/request-parts';
import { AutomationHeader, MethodTag, useAutomationBase } from '@/components/automation/shell';
import {
  useApiRequest,
  useAutomationEnv,
  useApiTree,
  useDeleteCollection,
  useDeleteRequest,
  useSaveCollection,
  useSaveRequest,
  useSendRequest,
  useStartRun,
  type ApiCollectionNode,
  type ApiExecution,
  type ApiRequestFull,
} from '@/hooks/automation';
import { useEnvironments } from '@/hooks/qa';
import { useCurrentProject } from '@/hooks/queries';
import { useHotkey } from '@/hooks/use-hotkey';
import { useCan } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';

type Draft = Pick<
  ApiRequestInput,
  'name' | 'method' | 'url' | 'headers' | 'query' | 'body' | 'auth' | 'assertions' | 'extract'
>;

const toDraft = (r: ApiRequestFull): Draft => ({
  name: r.name,
  method: r.method,
  url: r.url,
  headers: r.headers,
  query: r.query,
  body: r.body,
  auth: r.auth,
  assertions: r.assertions,
  extract: r.extract,
});

export default function ApiClientPage() {
  const { project } = useCurrentProject();
  const pid = project?.id;
  const canWrite = useCan('automation:write');
  const canRun = useCan('automation:run');
  const tree = useApiTree(pid);
  const envs = useEnvironments(pid);
  const [picked, setSelected] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [collectionDialog, setCollectionDialog] = useState<
    | { mode: 'new'; parentId: string | null }
    | { mode: 'edit'; collection: ApiCollectionNode }
    | null
  >(null);
  // Values extracted by earlier sends: later sends can use them ({{name}}), like a collection run.
  const [chained, setChained] = useState<Record<string, string>>({});

  // Defaults until the user picks: first environment, first request.
  const [envId, setEnvId] = useAutomationEnv(pid, envs.data);
  const selected = picked ?? tree.data?.find((c) => c.requests.length)?.requests[0]?.id ?? null;

  return (
    <div className="flex h-dvh flex-col">
      <AutomationHeader
        actions={
          <Select value={envId} onValueChange={setEnvId}>
            <SelectTrigger aria-label="Environment" className="h-8 w-44 text-xs">
              <Globe className="size-3.5" />
              <SelectValue placeholder={envs.isLoading ? 'Loading…' : 'No environment'} />
            </SelectTrigger>
            <SelectContent>
              {envs.data?.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {tree.isError ? (
        <ErrorState error={tree.error} retry={() => tree.refetch()} what="API collections" />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <CollectionTree
            collections={tree.data}
            loading={tree.isPending}
            selected={selected}
            onSelect={setSelected}
            canWrite={canWrite}
            canRun={canRun}
            projectId={pid ?? ''}
            envId={envId || null}
            onImport={() => setImportOpen(true)}
            onNewCollection={(parentId) => setCollectionDialog({ mode: 'new', parentId })}
            onEditCollection={(collection) => setCollectionDialog({ mode: 'edit', collection })}
          />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto p-4 lg:p-5">
            {tree.isPending ? (
              <Skeleton className="h-10" />
            ) : !tree.data?.length ? (
              <EmptyState
                icon={Network}
                title="Test your APIs"
                description="Create a collection, or import one from Postman, OpenAPI, Bruno or a cURL command. Requests can assert on status, headers, JSON and timing, and pass values to the next request."
                action={
                  canWrite && (
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setImportOpen(true)}>
                        <Upload /> Import
                      </Button>
                      <Button onClick={() => setCollectionDialog({ mode: 'new', parentId: null })}>
                        <Plus /> New collection
                      </Button>
                    </div>
                  )
                }
              />
            ) : selected ? (
              <RequestPane
                key={selected}
                id={selected}
                projectId={pid!}
                envId={envId || null}
                collections={tree.data}
                canWrite={canWrite}
                canRun={canRun}
                chained={chained}
                onExtracted={(v) => setChained((c) => ({ ...c, ...v }))}
                onClearChained={() => setChained({})}
                onDeleted={() => setSelected(null)}
              />
            ) : (
              <EmptyState
                icon={Send}
                title="Pick a request"
                description="Choose a request on the left, or add one to a collection."
              />
            )}
          </main>
        </div>
      )}
      {pid && (
        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          projectId={pid}
          collections={tree.data ?? []}
          onImported={() => setSelected(null)}
        />
      )}
      {pid && collectionDialog && (
        <CollectionDialog
          projectId={pid}
          state={collectionDialog}
          readOnly={!canWrite}
          onClose={() => setCollectionDialog(null)}
        />
      )}
    </div>
  );
}

// ---- tree ------------------------------------------------------------------------------------

function CollectionTree({
  collections,
  loading,
  selected,
  onSelect,
  canWrite,
  canRun,
  projectId,
  envId,
  onImport,
  onNewCollection,
  onEditCollection,
}: {
  collections: ApiCollectionNode[] | undefined;
  loading: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  canWrite: boolean;
  canRun: boolean;
  projectId: string;
  envId: string | null;
  onImport: () => void;
  onNewCollection: (parentId: string | null) => void;
  onEditCollection: (c: ApiCollectionNode) => void;
}) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const router = useRouter();
  const base = useAutomationBase();
  const save = useSaveRequest(projectId);
  const del = useDeleteCollection(projectId);
  const start = useStartRun(projectId);
  const byParent = useMemo(() => {
    const m = new Map<string | null, ApiCollectionNode[]>();
    for (const c of collections ?? []) m.set(c.parentId, [...(m.get(c.parentId) ?? []), c]);
    return m;
  }, [collections]);
  const needle = q.trim().toLowerCase();
  const matches = (c: ApiCollectionNode): boolean =>
    !needle ||
    c.name.toLowerCase().includes(needle) ||
    c.requests.some((r) => `${r.method} ${r.name} ${r.url}`.toLowerCase().includes(needle)) ||
    (byParent.get(c.id) ?? []).some(matches);
  const count = (c: ApiCollectionNode): number =>
    c.requests.length + (byParent.get(c.id) ?? []).reduce((a, x) => a + count(x), 0);

  const toggle = (id: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function addRequest(c: ApiCollectionNode) {
    save.mutate(
      {
        collectionId: c.id,
        name: 'New request',
        method: 'GET',
        url: '{{baseUrl}}/',
        assertions: [{ type: 'status', op: 'eq', value: '200' }],
      },
      { onSuccess: (r) => onSelect(r.id) },
    );
  }

  function runCollection(c: ApiCollectionNode) {
    start.mutate(
      {
        selection: { kind: 'collections', collectionIds: [c.id] },
        environmentId: envId,
        retries: 0,
      },
      { onSuccess: (r) => router.push(`${base}/runs/${r.ref}`) },
    );
  }

  const renderNode = (c: ApiCollectionNode, depth: number): React.ReactNode => {
    if (!matches(c)) return null;
    const open = !closed.has(c.id) || !!needle;
    return (
      <li key={c.id} role="treeitem" aria-expanded={open} aria-selected={false}>
        <div
          className="group flex items-center rounded-md hover:bg-accent"
          style={{ paddingLeft: depth * 14 }}
        >
          <button
            onClick={() => toggle(c.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1.5 text-left text-[13px] font-medium"
          >
            {open ? (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="truncate">{c.name}</span>
            <span className="ml-auto pr-1 text-[11px] font-normal text-muted-foreground">
              {count(c)}
            </span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-7 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`${c.name} actions`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canRun && (
                <DropdownMenuItem onSelect={() => runCollection(c)}>
                  <Play /> Run collection
                </DropdownMenuItem>
              )}
              {canWrite && (
                <>
                  <DropdownMenuItem onSelect={() => addRequest(c)}>
                    <Plus /> Add request
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onNewCollection(c.id)}>
                    <Plus /> Add folder
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem onSelect={() => onEditCollection(c)}>
                Variables &amp; auth
              </DropdownMenuItem>
              {canWrite && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      if (confirm(`Delete "${c.name}" and everything in it?`)) del.mutate(c.id);
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {open && (
          <ul role="group">
            {(byParent.get(c.id) ?? []).map((child) => renderNode(child, depth + 1))}
            {c.requests
              .filter(
                (r) =>
                  !needle ||
                  `${r.method} ${r.name} ${r.url}`.toLowerCase().includes(needle) ||
                  c.name.toLowerCase().includes(needle),
              )
              .map((r) => (
                <li key={r.id} role="treeitem" aria-selected={selected === r.id}>
                  <button
                    onClick={() => onSelect(r.id)}
                    style={{ paddingLeft: (depth + 1) * 14 + 8 }}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-[13px]',
                      selected === r.id ? 'bg-accent font-medium' : 'hover:bg-accent/60',
                    )}
                  >
                    <MethodTag method={r.method} />
                    <span className="truncate">{r.name}</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <aside
      aria-label="Collections"
      className="flex max-h-72 shrink-0 flex-col border-b bg-card md:max-h-none md:w-72 md:border-r md:border-b-0"
    >
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <h2 className="flex-1 text-sm font-semibold">Collections</h2>
        {canWrite && (
          <>
            <Button variant="ghost" size="icon-sm" onClick={onImport} aria-label="Import">
              <Upload className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onNewCollection(null)}
              aria-label="New collection"
            >
              <Plus className="size-4" />
            </Button>
          </>
        )}
      </div>
      <div className="relative px-3 pb-2">
        <Search
          className="absolute top-1/2 left-5.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter requests"
          aria-label="Filter requests"
          className="h-8 pl-7 text-xs"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {loading ? (
          <div className="grid gap-1.5 p-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-6" />
            ))}
          </div>
        ) : (
          <ul role="tree" aria-label="Requests">
            {(byParent.get(null) ?? []).map((c) => renderNode(c, 0))}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ---- request editor -------------------------------------------------------------------------

const REQUEST_TABS = ['params', 'headers', 'body', 'auth', 'assertions', 'extract'] as const;

function RequestPane({
  id,
  projectId,
  envId,
  collections,
  canWrite,
  canRun,
  chained,
  onExtracted,
  onClearChained,
  onDeleted,
}: {
  id: string;
  projectId: string;
  envId: string | null;
  collections: ApiCollectionNode[];
  canWrite: boolean;
  canRun: boolean;
  chained: Record<string, string>;
  onExtracted: (v: Record<string, string>) => void;
  onClearChained: () => void;
  onDeleted: () => void;
}) {
  const req = useApiRequest(projectId, id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<(typeof REQUEST_TABS)[number]>('params');
  const [result, setResult] = useState<ApiExecution | null>(null);
  const save = useSaveRequest(projectId);
  const send = useSendRequest(projectId);
  const del = useDeleteRequest(projectId);

  if (req.data && !draft) {
    setDraft(toDraft(req.data));
    if (req.data.assertions.length) setTab('assertions');
  }

  const dirty =
    !!draft && !!req.data && JSON.stringify(draft) !== JSON.stringify(toDraft(req.data));
  const path = useMemo(() => {
    const byId = new Map(collections.map((c) => [c.id, c]));
    const out: string[] = [];
    let c = req.data ? byId.get(req.data.collectionId) : undefined;
    while (c) {
      out.unshift(c.name);
      c = c.parentId ? byId.get(c.parentId) : undefined;
    }
    return out;
  }, [collections, req.data]);

  const doSave = useCallback(() => {
    if (!draft || !canWrite || !dirty) return;
    save.mutate({ id, ...draft }, { onSuccess: () => toast.success('Request saved') });
  }, [draft, canWrite, dirty, save, id]);

  const doSend = useCallback(() => {
    if (!draft || !req.data || !canRun || send.isPending) return;
    send.mutate(
      {
        collectionId: req.data.collectionId,
        environmentId: envId,
        variables: chained,
        method: draft.method,
        url: draft.url,
        headers: draft.headers,
        query: draft.query,
        body: draft.body,
        auth: draft.auth,
        assertions: draft.assertions,
        extract: draft.extract,
      },
      {
        onSuccess: (r) => {
          setResult(r);
          if (Object.keys(r.extracted).length) onExtracted(r.extracted);
        },
      },
    );
  }, [draft, req.data, canRun, send, envId, chained, onExtracted]);

  useHotkey('mod+enter', doSend, !!draft);
  useHotkey('mod+s', doSave, !!draft && canWrite);

  if (req.isError)
    return <ErrorState error={req.error} retry={() => req.refetch()} what="this request" />;
  if (!draft || !req.data)
    return (
      <div className="grid gap-3">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-10" />
        <Skeleton className="h-40" />
      </div>
    );

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const readOnly = !canWrite;
  const counts: Record<string, string | number> = {
    params: draft.query.length,
    headers: draft.headers.length,
    body: draft.body.type === 'none' ? '' : draft.body.type.toUpperCase(),
    auth:
      !draft.auth || draft.auth.type === 'inherit'
        ? 'Inherit'
        : draft.auth.type === 'none'
          ? ''
          : 'Set',
    assertions: draft.assertions.length,
    extract: draft.extract.length,
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <nav
          aria-label="Request location"
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
        >
          {path.join(' / ')} /{' '}
          <input
            value={draft.name}
            readOnly={readOnly}
            aria-label="Request name"
            onChange={(e) => set({ name: e.target.value })}
            className="rounded bg-transparent px-1 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </nav>
        {req.data.testCase && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            Linked to TC-{req.data.testCase.seq}
          </span>
        )}
        {canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Request actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  if (confirm(`Delete "${draft.name}"?`)) del.mutate(id, { onSuccess: onDeleted });
                }}
              >
                Delete request
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          doSend();
        }}
      >
        <div className="flex min-w-0 flex-1 items-center rounded-lg border bg-card focus-within:ring-2 focus-within:ring-ring">
          <Select
            value={draft.method}
            onValueChange={(m) => set({ method: m as HttpMethod })}
            disabled={readOnly}
          >
            <SelectTrigger
              aria-label="Method"
              className="h-10 w-28 border-0 font-mono text-xs font-semibold shadow-none"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HTTP_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  <MethodTag method={m} className="w-auto" />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            value={draft.url}
            readOnly={readOnly}
            onChange={(e) => set({ url: e.target.value })}
            aria-label="URL"
            spellCheck={false}
            placeholder="{{baseUrl}}/v1/items"
            className="h-10 min-w-0 flex-1 bg-transparent px-2 font-mono text-[13px] outline-none"
          />
        </div>
        {canWrite && (
          <Button
            type="button"
            variant="outline"
            className="h-10"
            onClick={doSave}
            disabled={!dirty || save.isPending}
          >
            {save.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </Button>
        )}
        {canRun && (
          <Button type="submit" className="h-10" disabled={send.isPending}>
            <Send /> {send.isPending ? 'Sending…' : 'Send'}
          </Button>
        )}
      </form>

      {Object.keys(chained).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>Chained from earlier sends:</span>
          {Object.keys(chained).map((k) => (
            <code key={k} className="rounded bg-primary-subtle px-1.5 py-0.5 text-primary">
              {`{{${k}}}`}
            </code>
          ))}
          <button className="underline hover:text-foreground" onClick={onClearChained}>
            Clear
          </button>
        </div>
      )}

      <div
        role="tablist"
        aria-label="Request parts"
        className="flex gap-1 overflow-x-auto border-b"
      >
        {REQUEST_TABS.map((t) => (
          <button
            key={t}
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            onClick={() => setTab(t)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] capitalize',
              tab === t
                ? 'border-primary font-semibold'
                : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
            {!!counts[t] && (
              <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
                {counts[t]}
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="shrink-0">
        {tab === 'params' && (
          <KeyValueTable
            label="Query parameters"
            rows={draft.query}
            readOnly={readOnly}
            onChange={(query) => set({ query })}
          />
        )}
        {tab === 'headers' && (
          <KeyValueTable
            label="Headers"
            rows={draft.headers}
            readOnly={readOnly}
            onChange={(headers) => set({ headers })}
          />
        )}
        {tab === 'body' && (
          <BodyEditor body={draft.body} readOnly={readOnly} onChange={(body) => set({ body })} />
        )}
        {tab === 'auth' && (
          <AuthEditor
            auth={draft.auth ?? { type: 'inherit' }}
            allowInherit
            readOnly={readOnly}
            onChange={(a: ApiAuth) => set({ auth: a.type === 'inherit' ? null : a })}
          />
        )}
        {tab === 'assertions' && (
          <AssertionsEditor
            assertions={draft.assertions}
            readOnly={readOnly}
            outcomes={result?.assertions}
            onChange={(assertions) => set({ assertions })}
          />
        )}
        {tab === 'extract' && (
          <ExtractEditor
            rules={draft.extract}
            readOnly={readOnly}
            onChange={(extract) => set({ extract })}
          />
        )}
      </div>

      {result ? (
        <ResponseView result={result} />
      ) : (
        <div className="flex min-h-40 flex-1 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
          {canRun ? (
            <span>
              Press <kbd className="rounded border bg-muted px-1 font-mono text-[11px]">Ctrl</kbd> +{' '}
              <kbd className="rounded border bg-muted px-1 font-mono text-[11px]">Enter</kbd> or
              Send to see the response.
            </span>
          ) : (
            'Your role can view requests but not send them.'
          )}
        </div>
      )}
    </>
  );
}

// ---- collection create / settings -------------------------------------------------------------

function CollectionDialog({
  projectId,
  state,
  readOnly,
  onClose,
}: {
  projectId: string;
  state: { mode: 'new'; parentId: string | null } | { mode: 'edit'; collection: ApiCollectionNode };
  readOnly: boolean;
  onClose: () => void;
}) {
  const c = state.mode === 'edit' ? state.collection : null;
  const nested = c ? !!c.parentId : state.mode === 'new' && !!state.parentId;
  const [name, setName] = useState(c?.name ?? '');
  const [vars, setVars] = useState<KeyValue[]>(
    Object.entries(c?.variables ?? {}).map(([n, value]) => ({ name: n, value, enabled: true })),
  );
  const [auth, setAuth] = useState<ApiAuth>(c?.auth ?? { type: 'none' });
  const save = useSaveCollection(projectId);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(
      {
        id: c?.id,
        name,
        ...(state.mode === 'new' ? { parentId: state.parentId } : {}),
        variables: Object.fromEntries(
          vars.filter((v) => v.enabled && v.name).map((v) => [v.name, v.value]),
        ),
        auth,
      },
      { onSuccess: onClose },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {c
                ? c.name
                : state.mode === 'new' && state.parentId
                  ? 'New folder'
                  : 'New collection'}
            </DialogTitle>
            <DialogDescription>
              Variables and auth apply to every request inside, unless a request sets its own.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-sm font-medium">
            Name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              readOnly={readOnly}
              autoFocus
            />
          </label>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Variables</span>
            <KeyValueTable
              label="Collection variables"
              rows={vars}
              onChange={setVars}
              readOnly={readOnly}
            />
            <span className="text-xs text-muted-foreground">
              Don’t put secrets here. Use environment secrets and reference them as {'{{env.NAME}}'}
              .
            </span>
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Auth</span>
            <AuthEditor auth={auth} onChange={setAuth} allowInherit={nested} readOnly={readOnly} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={!name.trim() || save.isPending}>
                {c ? 'Save' : 'Create'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
