'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, FileText, MoreHorizontal, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  humanize,
  PRIORITIES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  type Priority,
  type RequirementStatus,
  type RequirementType,
} from '@qaforge/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AiJobButton } from '@/components/ai/ai-button';
import { AiAnalysisPanel } from '@/components/requirements/ai-analysis';
import { buildTree, descendantIds } from '@/lib/tree';
import { useLatestJob } from '@/hooks/ai';
import { VersionHistory } from '@/components/qa/history';
import { InlineText } from '@/components/qa/inline-text';
import { RichTextEditor } from '@/components/qa/rich-text';
import { AiBadge, Ref, TestCaseStatusBadge } from '@/components/qa/status';
import { TestCasePicker } from '@/components/qa/test-case-picker';
import { TYPE_ICON } from '@/components/requirements/requirement-tree';
import { useCurrentProject } from '@/hooks/queries';
import {
  useCreateTestCase,
  useDeleteRequirement,
  useLinkTestCases,
  useRequirement,
  useRequirements,
  useRestoreRequirements,
  useUnlinkTestCase,
  useUpdateRequirement,
} from '@/hooks/qa';
import { useCan } from '@/hooks/use-permission';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export default function RequirementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { project, org } = useCurrentProject();
  const pid = project?.id ?? '';
  const req = useRequirement(project?.id, id);
  const update = useUpdateRequirement(pid, id);
  const del = useDeleteRequirement(pid);
  const restore = useRestoreRequirements(pid);
  const link = useLinkTestCases(pid, id);
  const unlink = useUnlinkTestCase(pid, id);
  const createTc = useCreateTestCase(pid);
  const canEdit = useCan('requirement:write');
  const canWriteTc = useCan('testcase:write');
  const [newCriterion, setNewCriterion] = useState('');
  const all = useRequirements(project?.id);
  const genJob = useLatestJob(project?.id, id, 'generate-test-cases');
  // Stories are what get test cases; for an epic/feature, generate for the stories beneath it.
  const genIds = useMemo(() => {
    if (!req.data) return [];
    if (req.data.type === 'STORY') return [req.data.id];
    const rows = all.data ?? [];
    const kids = descendantIds(buildTree(rows), req.data.id);
    return rows
      .filter((x) => kids.has(x.id) && x.type === 'STORY')
      .map((x) => x.id)
      .slice(0, 25);
  }, [req.data, all.data]);

  if (!project || !org || req.isLoading)
    return (
      <div className="grid gap-3 p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40" />
      </div>
    );
  if (!req.data)
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Requirement not found. It may have been deleted.
      </div>
    );
  const r = req.data;
  const base = `/${org.slug}/p/${project.key}`;
  const Icon = TYPE_ICON[r.type];

  const save = (input: Parameters<typeof update.mutate>[0], msg?: string) =>
    update.mutate(input, {
      onSuccess: () => msg && toast.success(msg),
      onError: (e) => toast.error(e.message),
    });

  const remove = async () => {
    const res = await del.mutateAsync(r.id);
    router.push(`${base}/requirements`);
    toast.success(
      res.ids.length > 1
        ? `Deleted ${r.ref} and ${res.ids.length - 1} child item(s)`
        : `Deleted ${r.ref}`,
      {
        action: {
          label: 'Undo',
          onClick: () => restore.mutate(res.ids, { onSuccess: () => toast.success('Restored') }),
        },
      },
    );
  };

  const addCriterion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCriterion.trim()) return;
    save({ acceptanceCriteria: [...r.acceptanceCriteria, newCriterion.trim()] });
    setNewCriterion('');
  };

  const newTestCase = async () => {
    const tc = await createTc.mutateAsync({
      title: r.title,
      requirementIds: [r.id],
      priority: r.priority,
    });
    toast.success(`${tc.ref} created and linked`);
    router.push(`${base}/test-cases/${tc.ref}`);
  };

  return (
    <article className="grid gap-6 p-6" aria-labelledby="req-title">
      <div className="flex items-start gap-3">
        <Link
          href={`${base}/requirements`}
          className="mt-1 rounded p-1 text-muted-foreground hover:bg-accent lg:hidden"
          aria-label="Back to tree"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <Icon className="mt-1.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Ref>{r.ref}</Ref>
            {r.aiGenerated && <AiBadge />}
            <span className="text-xs text-muted-foreground">v{r.version}</span>
          </div>
          <h2 id="req-title" className="text-lg font-semibold">
            <InlineText
              value={r.title}
              label="title"
              editable={canEdit}
              onSave={(title) => save({ title })}
            />
          </h2>
        </div>
        {canWriteTc && genIds.length > 0 && (
          <AiJobButton
            projectId={project.id}
            agent="test-case-writer"
            input={{
              kind: 'generate-test-cases',
              requirementIds: genIds,
              maxCasesPerRequirement: 6,
            }}
            job={genJob}
            size="default"
            label={
              r.type === 'STORY'
                ? 'Generate test cases'
                : `Generate for ${genIds.length} stor${genIds.length === 1 ? 'y' : 'ies'}`
            }
          />
        )}
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={remove}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Type">
          <Select
            value={r.type}
            disabled={!canEdit}
            onValueChange={(v) => save({ type: v as RequirementType })}
          >
            <SelectTrigger size="sm" className="w-full" aria-label="Type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REQUIREMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t === 'STORY' ? 'User story' : humanize(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Priority">
          <Select
            value={r.priority}
            disabled={!canEdit}
            onValueChange={(v) => save({ priority: v as Priority })}
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
        <Field label="Status">
          <Select
            value={r.status}
            disabled={!canEdit}
            onValueChange={(v) => save({ status: v as RequirementStatus })}
          >
            <SelectTrigger size="sm" className="w-full" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REQUIREMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {humanize(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Clarity">
          <span
            className="text-sm text-muted-foreground"
            title="Scored by the Requirement Agent (Phase 3)"
          >
            {r.clarityScore ?? 'Not scored'}
          </span>
        </Field>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="tests">Test cases ({r.testCases.length})</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="mt-4 grid gap-6">
          <Field label="Description">
            <RichTextEditor
              value={r.description}
              editable={canEdit}
              label="Description"
              onSave={(description) => save({ description })}
            />
          </Field>
          <section aria-labelledby="ac-h" className="grid gap-2">
            <h3 id="ac-h" className="text-xs font-medium text-muted-foreground">
              Acceptance criteria
            </h3>
            {r.acceptanceCriteria.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No acceptance criteria yet. Clear criteria make better test cases.
              </p>
            )}
            <ol className="grid gap-1.5">
              {r.acceptanceCriteria.map((c, i) => (
                <li
                  key={`${i}-${c}`}
                  className="group flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="mt-px text-xs font-semibold text-muted-foreground">
                    AC{i + 1}
                  </span>
                  <InlineText
                    className="flex-1"
                    value={c}
                    label={`acceptance criterion ${i + 1}`}
                    editable={canEdit}
                    onSave={(v) =>
                      save({
                        acceptanceCriteria: r.acceptanceCriteria.map((x, j) => (j === i ? v : x)),
                      })
                    }
                  />
                  {canEdit && (
                    <button
                      className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-destructive"
                      aria-label={`Remove criterion ${i + 1}`}
                      onClick={() =>
                        save({ acceptanceCriteria: r.acceptanceCriteria.filter((_, j) => j !== i) })
                      }
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ol>
            {canEdit && (
              <form onSubmit={addCriterion} className="flex gap-2">
                <Input
                  value={newCriterion}
                  onChange={(e) => setNewCriterion(e.target.value)}
                  placeholder="Given… when… then…"
                  aria-label="New acceptance criterion"
                />
                <Button type="submit" variant="outline" disabled={!newCriterion.trim()}>
                  <Plus /> Add
                </Button>
              </form>
            )}
          </section>
          <AiAnalysisPanel
            projectId={project.id}
            r={r}
            canEdit={canEdit}
            onAddCriterion={(c) =>
              save({ acceptanceCriteria: [...r.acceptanceCriteria, c] }, 'Criterion added')
            }
          />
          {r.source && (
            <Field label="Source">
              {r.source.attachmentId ? (
                <a
                  className="inline-flex items-center gap-1.5 text-sm hover:underline"
                  href={`/v1/projects/${project.id}/attachments/${r.source.attachmentId}/download`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FileText className="size-4" /> {r.source.name}
                </a>
              ) : (
                <a
                  className="inline-flex items-center gap-1.5 text-sm hover:underline"
                  href={r.source.url ?? '#'}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {r.source.name} <ExternalLink className="size-3" />
                </a>
              )}
            </Field>
          )}
        </TabsContent>
        <TabsContent value="tests" className="mt-4 grid gap-3">
          {canWriteTc && (
            <div className="flex justify-end gap-2">
              <TestCasePicker
                projectId={project.id}
                exclude={r.testCases.map((t) => t.id)}
                onPick={(tcId) => link.mutate([tcId], { onSuccess: () => toast.success('Linked') })}
              />
              <Button size="sm" onClick={newTestCase} disabled={createTc.isPending}>
                <Plus /> New test case
              </Button>
            </div>
          )}
          {r.testCases.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No test cases cover this requirement yet.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {r.testCases.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <Ref>{t.ref}</Ref>
                  <Link
                    href={`${base}/test-cases/${t.ref}`}
                    className="flex-1 truncate hover:underline"
                  >
                    {t.title}
                  </Link>
                  <TestCaseStatusBadge status={t.status} />
                  {canWriteTc && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Unlink ${t.ref}`}
                      onClick={() =>
                        unlink.mutate(t.id, {
                          onSuccess: () =>
                            toast.success(`${t.ref} unlinked`, {
                              action: { label: 'Undo', onClick: () => link.mutate([t.id]) },
                            }),
                        })
                      }
                    >
                      <X />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <VersionHistory projectId={project.id} orgId={org.id} kind="requirements" id={r.id} />
        </TabsContent>
      </Tabs>
    </article>
  );
}
