'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AUTOMATION_STATUSES,
  canTransition,
  humanize,
  PRIORITIES,
  TEST_CASE_TYPES,
  TEST_TECHNIQUES,
  type AutomationStatus,
  type Priority,
  type TestCaseStatus,
  type TestCaseType,
  type TestTechnique,
} from '@qaforge/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { VersionHistory } from '@/components/qa/history';
import { RequirementPicker } from '@/components/qa/requirement-picker';
import { AiBadge, Ref, TestCaseStatusBadge } from '@/components/qa/status';
import { newStep, StepsEditor, type DraftStep } from '@/components/test-cases/steps-editor';
import { TestDataEditor, type TestDataDraft } from '@/components/test-cases/test-data-editor';
import { TestCaseAiPanel } from '@/components/test-cases/ai-panel';
import { useCurrentProject } from '@/hooks/queries';
import {
  useBulkTestCases,
  useSetTestCaseStatus,
  useSuites,
  useTestCase,
  useTestCaseByRef,
  useUpdateTestCase,
} from '@/hooks/qa';
import { useHotkey } from '@/hooks/use-hotkey';
import { useCan } from '@/hooks/use-permission';
import type { TestCaseDetail } from '@/lib/types';

interface Draft {
  title: string;
  preconditions: string;
  steps: DraftStep[];
  testData: TestDataDraft | null;
}

const toDraft = (t: TestCaseDetail): Draft => ({
  title: t.title,
  preconditions: t.preconditions,
  steps: t.steps.map((s) =>
    newStep({ action: s.action, expected: s.expected, sharedStepId: s.sharedStepId }),
  ),
  testData: t.testData,
});
const comparable = (d: Draft) =>
  JSON.stringify({
    ...d,
    steps: d.steps.map(({ action, expected, sharedStepId }) => ({
      action,
      expected,
      sharedStepId,
    })),
  });

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export default function TestCaseDetailPage() {
  const { ref } = useParams<{ ref: string }>();
  const router = useRouter();
  const { project, org } = useCurrentProject();
  const pid = project?.id ?? '';
  const lookup = useTestCaseByRef(project?.id, ref?.toUpperCase());
  const id = lookup.data?.id;
  const tc = useTestCase(project?.id, id);
  const update = useUpdateTestCase(pid, id ?? '');
  const setStatus = useSetTestCaseStatus(pid);
  const bulk = useBulkTestCases(pid);
  const suites = useSuites(project?.id);
  const canWrite = useCan('testcase:write');
  const canApprove = useCan('testcase:approve');

  const [draft, setDraft] = useState<Draft | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [tagInput, setTagInput] = useState('');
  const original = useMemo(() => (tc.data ? toDraft(tc.data) : null), [tc.data]);
  // When fresh server data arrives, adopt it unless the user has unsaved edits (relative to the previous data).
  const lastOriginal = useRef<Draft | null>(null);
  useEffect(() => {
    if (!original) return;
    setDraft((d) =>
      d && lastOriginal.current && comparable(d) !== comparable(lastOriginal.current)
        ? d
        : original,
    );
    lastOriginal.current = original;
  }, [original]);
  const dirty = !!draft && !!original && comparable(draft) !== comparable(original);

  // Warn before leaving with unsaved step edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const saveContent = async () => {
    if (!draft || !dirty) return;
    if (!draft.title.trim()) return toast.error('Title cannot be empty');
    try {
      const res = await update.mutateAsync({
        title: draft.title.trim(),
        preconditions: draft.preconditions,
        steps: draft.steps.map(({ action, expected, sharedStepId }) => ({
          action,
          expected,
          sharedStepId,
        })),
        testData: draft.testData && draft.testData.columns.length ? draft.testData : null,
        changeNote: changeNote.trim() || undefined,
      });
      setChangeNote('');
      toast.success(`Saved as version ${res.version}`, {
        description:
          tc.data?.status === 'APPROVED'
            ? 'Content changed, so it went back to review.'
            : undefined,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    }
  };
  useHotkey('mod+s', () => void saveContent(), dirty);

  if (!project || !org || lookup.isLoading || (id && tc.isLoading))
    return (
      <div className="grid gap-3 p-8">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64" />
      </div>
    );
  if (!tc.data || !draft)
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Test case {ref} not found.{' '}
        <Link
          className="text-primary hover:underline"
          href={`/${org.slug}/p/${project.key}/test-cases`}
        >
          Back to test cases
        </Link>
      </div>
    );

  const t = tc.data;
  const base = `/${org.slug}/p/${project.key}`;
  const meta = (input: Parameters<typeof update.mutate>[0], msg?: string) =>
    update.mutate(input, {
      onSuccess: () => msg && toast.success(msg),
      onError: (e) => toast.error(e.message),
    });
  const changeStatus = (status: TestCaseStatus, label: string) =>
    setStatus.mutate(
      { id: t.id, status },
      {
        onSuccess: () =>
          toast.success(`${t.ref}: ${label}`, {
            action: canTransition(status, t.status)
              ? { label: 'Undo', onClick: () => setStatus.mutate({ id: t.id, status: t.status }) }
              : undefined,
          }),
        onError: (e) => toast.error(e.message),
      },
    );
  const remove = async () => {
    await bulk.mutateAsync({ action: 'delete', ids: [t.id] });
    router.push(`${base}/test-cases`);
    toast.success(`Deleted ${t.ref}`, {
      action: { label: 'Undo', onClick: () => bulk.mutate({ action: 'restore', ids: [t.id] }) },
    });
  };
  const addTag = (e: React.FormEvent) => {
    e.preventDefault();
    const tag = tagInput.trim().toLowerCase().replace(/^#/, '');
    if (tag && !t.tags.includes(tag)) meta({ tags: [...t.tags, tag] });
    setTagInput('');
  };

  const editable = canWrite;
  const primary: {
    label: string;
    icon: React.ElementType;
    status: TestCaseStatus;
    show: boolean;
  }[] = [
    {
      label: 'Submit for review',
      icon: Send,
      status: 'IN_REVIEW',
      show: canWrite && t.status === 'DRAFT',
    },
    {
      label: 'Approve',
      icon: CheckCircle2,
      status: 'APPROVED',
      show: canApprove && (t.status === 'DRAFT' || t.status === 'IN_REVIEW'),
    },
    {
      label: 'Send back to draft',
      icon: Undo2,
      status: 'DRAFT',
      show: (canApprove || canWrite) && t.status === 'IN_REVIEW',
    },
    {
      label: 'Reopen for review',
      icon: RotateCcw,
      status: 'IN_REVIEW',
      show: canWrite && t.status === 'APPROVED',
    },
    {
      label: 'Restore to draft',
      icon: RotateCcw,
      status: 'DRAFT',
      show: canWrite && t.status === 'DEPRECATED',
    },
  ];

  return (
    <div className="pb-24">
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b bg-background/90 px-6 py-3 backdrop-blur lg:px-8">
        <Link
          href={`${base}/test-cases`}
          className="rounded p-1 text-muted-foreground hover:bg-accent"
          aria-label="Back to test cases"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <Ref>{t.ref}</Ref>
        <TestCaseStatusBadge status={t.status} />
        {t.aiGenerated && <AiBadge confidence={t.aiConfidence} />}
        <span className="text-xs text-muted-foreground">v{t.version}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {primary
            .filter((a) => a.show)
            .map((a) => (
              <Button
                key={a.label}
                size="sm"
                variant={a.status === 'APPROVED' ? 'default' : 'outline'}
                onClick={() => changeStatus(a.status, a.label)}
                disabled={setStatus.isPending}
              >
                <a.icon /> {a.label}
              </Button>
            ))}
          {canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled>
                  <Bot /> Convert to automation (Phase 5)
                </DropdownMenuItem>
                {t.status !== 'DEPRECATED' && (
                  <DropdownMenuItem onSelect={() => changeStatus('DEPRECATED', 'Deprecated')}>
                    Deprecate
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={remove}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="grid gap-8 px-6 pt-6 lg:grid-cols-[1fr_18rem] lg:px-8">
        <div className="grid min-w-0 content-start gap-6">
          <Input
            className="-mx-2 h-auto border-transparent px-2 py-1 text-xl font-semibold shadow-none hover:border-input focus-visible:border-ring"
            value={draft.title}
            readOnly={!editable}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            aria-label="Title"
          />
          <TestCaseAiPanel
            projectId={project.id}
            basePath={base}
            t={t}
            canEdit={editable}
            onUseSteps={(steps) => {
              setDraft({ ...draft, steps: steps.map((st) => newStep(st)) });
              toast.info('Suggested steps loaded. Review them, then save.');
            }}
          />
          <Tabs defaultValue="steps">
            <TabsList>
              <TabsTrigger value="steps">Steps & data</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <TabsContent value="steps" className="mt-4 grid gap-6">
              <Field label="Preconditions">
                <Textarea
                  value={draft.preconditions}
                  readOnly={!editable}
                  onChange={(e) => setDraft({ ...draft, preconditions: e.target.value })}
                  placeholder="State the system must be in before step 1"
                />
              </Field>
              <section aria-labelledby="steps-h" className="grid gap-2">
                <h2 id="steps-h" className="text-xs font-medium text-muted-foreground">
                  Steps
                </h2>
                <StepsEditor
                  projectId={project.id}
                  steps={draft.steps}
                  onChange={(steps) => setDraft({ ...draft, steps })}
                  editable={editable}
                />
              </section>
              <section aria-labelledby="data-h" className="grid gap-2">
                <h2 id="data-h" className="text-xs font-medium text-muted-foreground">
                  Test data
                </h2>
                <TestDataEditor
                  value={draft.testData}
                  onChange={(testData) => setDraft({ ...draft, testData })}
                  editable={editable}
                />
              </section>
            </TabsContent>
            <TabsContent value="history" className="mt-4">
              <VersionHistory projectId={project.id} orgId={org.id} kind="test-cases" id={t.id} />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="grid content-start gap-4 lg:border-l lg:pl-6" aria-label="Properties">
          <Field label="Priority">
            <Select
              value={t.priority}
              disabled={!editable}
              onValueChange={(v) => meta({ priority: v as Priority })}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {humanize(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Type">
            <Select
              value={t.type}
              disabled={!editable}
              onValueChange={(v) => meta({ type: v as TestCaseType })}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEST_CASE_TYPES.map((x) => (
                  <SelectItem key={x} value={x}>
                    {humanize(x)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Technique">
            <Select
              value={t.technique ?? 'none'}
              disabled={!editable}
              onValueChange={(v) => meta({ technique: v === 'none' ? null : (v as TestTechnique) })}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Technique">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {TEST_TECHNIQUES.map((x) => (
                  <SelectItem key={x} value={x}>
                    {humanize(x)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Automation">
            <Select
              value={t.automationStatus}
              disabled={!editable}
              onValueChange={(v) => meta({ automationStatus: v as AutomationStatus })}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Automation status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTOMATION_STATUSES.map((x) => (
                  <SelectItem key={x} value={x}>
                    {humanize(x)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Suite">
            <Select
              value={t.suiteId ?? 'none'}
              disabled={!editable}
              onValueChange={(v) => meta({ suiteId: v === 'none' ? null : v }, 'Moved')}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Suite">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unsorted</SelectItem>
                {suites.data?.suites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Estimate (minutes)">
            <Input
              type="number"
              min={0}
              className="h-8"
              readOnly={!editable}
              defaultValue={t.estimateMinutes ?? ''}
              key={t.estimateMinutes ?? 'none'}
              onBlur={(e) => {
                const v =
                  e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value)));
                if (v !== t.estimateMinutes) meta({ estimateMinutes: v });
              }}
              aria-label="Estimate in minutes"
            />
          </Field>
          <Field label="Tags">
            <div className="flex flex-wrap gap-1">
              {t.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  #{tag}
                  {editable && (
                    <button
                      className="ml-0.5 hover:text-destructive"
                      onClick={() => meta({ tags: t.tags.filter((x) => x !== tag) })}
                      aria-label={`Remove tag ${tag}`}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>
            {editable && (
              <form onSubmit={addTag}>
                <Input
                  className="h-8"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="Add tag and press Enter"
                  aria-label="Add tag"
                />
              </form>
            )}
          </Field>
          <Field label="Requirements">
            {t.requirements.length === 0 && (
              <p className="text-xs text-warning-text">
                Not linked: this test won&apos;t count toward coverage.
              </p>
            )}
            <ul className="grid gap-1">
              {t.requirements.map((r) => (
                <li key={r.id} className="group flex items-center gap-2 text-sm">
                  <Ref>{r.ref}</Ref>
                  <Link
                    className="flex-1 truncate hover:underline"
                    href={`${base}/requirements/${r.id}`}
                  >
                    {r.title}
                  </Link>
                  {editable && (
                    <button
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-destructive"
                      onClick={() =>
                        meta({
                          requirementIds: t.requirements
                            .filter((x) => x.id !== r.id)
                            .map((x) => x.id),
                        })
                      }
                      aria-label={`Unlink ${r.ref}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {editable && (
              <RequirementPicker
                projectId={project.id}
                exclude={t.requirements.map((r) => r.id)}
                onPick={(rid) =>
                  meta(
                    { requirementIds: [...t.requirements.map((r) => r.id), rid] },
                    'Requirement linked',
                  )
                }
              />
            )}
          </Field>
        </aside>
      </div>

      {dirty && (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="fixed inset-x-0 bottom-4 z-30 mx-auto flex w-[min(40rem,calc(100%-2rem))] items-center gap-2 rounded-xl border bg-popover p-2 shadow-lg"
        >
          <span className="px-2 text-sm font-medium">Unsaved changes</span>
          <Input
            className="h-8 flex-1"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            placeholder="What changed? (optional)"
            aria-label="Change note"
          />
          <Button size="sm" variant="ghost" onClick={() => setDraft(original)}>
            Discard
          </Button>
          <Button size="sm" onClick={saveContent} disabled={update.isPending}>
            {update.isPending && <Loader2 className="animate-spin" />} Save{' '}
            <kbd className="ml-1 text-[10px] opacity-70">⌘S</kbd>
          </Button>
        </div>
      )}
    </div>
  );
}
