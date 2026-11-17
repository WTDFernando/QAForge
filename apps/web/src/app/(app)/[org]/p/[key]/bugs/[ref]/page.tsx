'use client';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Check,
  ChevronRight,
  Copy,
  Link2,
  Loader2,
  Paperclip,
  Play,
  Plus,
  Send,
  Sparkles,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BUG_RESOLUTIONS,
  BUG_SEVERITIES,
  BUG_TRANSITIONS,
  humanize,
  PRIORITIES,
  type BugResolution,
  type BugSeverity,
  type BugStatus,
  type Priority,
} from '@qaforge/shared';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { Topbar } from '@/components/shell/topbar';
import { AnnotatedImage } from '@/components/bugs/annotated-image';
import { SeverityBadge } from '@/components/qa/run-status';
import {
  bugKeys,
  useAddComment,
  useBugByRef,
  useComments,
  useSetBugStatus,
  useUpdateBug,
} from '@/hooks/bugs';
import { useCurrentProject, useMembers } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';
import { api } from '@/lib/api';
import type { BugDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

const FLOW: BugStatus[] = ['NEW', 'TRIAGED', 'IN_PROGRESS', 'FIXED', 'READY_FOR_RETEST', 'CLOSED'];
const NEXT_LABEL: Partial<Record<BugStatus, string>> = {
  TRIAGED: 'Triage',
  IN_PROGRESS: 'Start work',
  FIXED: 'Mark fixed',
  READY_FOR_RETEST: 'Ready for retest',
  CLOSED: 'Close',
  REOPENED: 'Reopen',
};
const UNASSIGNED = '__none';

export default function BugDetailPage() {
  const { ref } = useParams<{ ref: string }>();
  const { project, org } = useCurrentProject();
  const bug = useBugByRef(project?.id, ref?.toUpperCase());
  if (bug.isError)
    return (
      <>
        <Topbar />
        <ErrorState error={bug.error} retry={() => bug.refetch()} what={`bug ${ref}`} />
      </>
    );
  if (!project || !org || !bug.data)
    return (
      <>
        <Topbar />
        <div className="grid gap-3 p-6">
          <Skeleton className="h-8 w-96" />
          <Skeleton className="h-8 w-[32rem]" />
          <Skeleton className="h-80" />
        </div>
      </>
    );
  return (
    <Detail
      bug={bug.data}
      projectId={project.id}
      orgId={org.id}
      base={`/${org.slug}/p/${project.key}`}
    />
  );
}

function Detail({
  bug,
  projectId,
  orgId,
  base,
}: {
  bug: BugDetail;
  projectId: string;
  orgId: string;
  base: string;
}) {
  const canWrite = useCan('bug:write');
  const canComment = useCan('comment:write');
  const members = useMembers(orgId);
  const update = useUpdateBug(projectId, bug.id);
  const setStatus = useSetBugStatus(projectId);
  const [closing, setClosing] = useState(false);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const people = useMemo(
    () => new Map(members.data?.map((m) => [m.user.id, m.user]) ?? []),
    [members.data],
  );

  const patch = async (input: Parameters<typeof update.mutateAsync>[0], msg: string) => {
    try {
      await update.mutateAsync(input);
      toast.success(msg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    }
  };
  const move = async (status: BugStatus) => {
    if (status === 'CLOSED') return setClosing(true);
    try {
      await setStatus.mutateAsync({ id: bug.id, status });
      toast.success(`${bug.ref} is now ${humanize(status).toLowerCase()}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change the status');
    }
  };
  const upload = async (files: File[]) => {
    setUploading(true);
    try {
      for (const f of files)
        await api.upload(`/v1/projects/${projectId}/bugs/${bug.id}/attachments`, f);
      toast.success('Evidence added');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      void qc.invalidateQueries({ queryKey: bugKeys.all(projectId) });
    }
  };

  const current = bug.status === 'REOPENED' ? 'NEW' : bug.status;
  const curIdx = FLOW.indexOf(current);
  const nexts = BUG_TRANSITIONS[bug.status];
  const primaryNext =
    nexts.find((s) => FLOW.indexOf(s) === curIdx + 1) ?? nexts.find((s) => s === 'REOPENED');
  const images = bug.attachments.filter(
    (a) =>
      a.contentType.startsWith('image/') &&
      a.scanStatus !== 'INFECTED' &&
      a.scanStatus !== 'PENDING',
  );
  const others = bug.attachments.filter((a) => !images.includes(a));
  const fileUrl = (id: string) => `/v1/projects/${projectId}/attachments/${id}/download`;
  const notes = bug.aiNotes;

  return (
    <div className="pb-10">
      <Topbar>
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1.5 truncate text-sm text-muted-foreground"
        >
          <Link href={`${base}/bugs`} className="hover:text-foreground">
            Bugs
          </Link>
          <ChevronRight className="size-3.5" aria-hidden />
          <span className="font-medium text-foreground">{bug.ref}</span>
        </nav>
      </Topbar>
      <header className="border-b bg-card px-6 pt-5 pb-4 lg:px-8">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-sm text-muted-foreground">{bug.ref}</span>
              <SeverityBadge severity={bug.severity} />
              {bug.aiGenerated && (
                <span className="inline-flex items-center gap-1 rounded-md bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary">
                  <Sparkles className="size-3" aria-hidden /> Drafted by Bug Agent
                </span>
              )}
              {bug.status === 'REOPENED' && (
                <span className="rounded-md bg-destructive-subtle px-2 py-0.5 text-xs font-medium text-destructive-text">
                  Reopened
                </span>
              )}
              {bug.resolution && (
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                  {humanize(bug.resolution)}
                </span>
              )}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{bug.title}</h1>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href);
              toast.success('Link copied');
            }}
          >
            <Link2 /> Copy link
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <ol className="flex flex-wrap items-center gap-1.5" aria-label="Workflow">
            {FLOW.map((s, i) => {
              const done = i < curIdx;
              const cur = i === curIdx;
              return (
                <li key={s} className="flex items-center gap-1.5">
                  {i > 0 && <span className="h-px w-4 bg-border" aria-hidden />}
                  <span
                    aria-current={cur ? 'step' : undefined}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                      cur
                        ? 'bg-primary text-primary-foreground'
                        : done
                          ? 'bg-success-subtle text-success-text'
                          : 'border text-muted-foreground',
                    )}
                  >
                    {done && <Check className="size-3" aria-hidden />}
                    {cur && <Play className="size-3" aria-hidden />}
                    {humanize(s)}
                  </span>
                </li>
              );
            })}
          </ol>
          {canWrite && (
            <div className="ml-auto flex flex-wrap gap-2">
              {nexts
                .filter((s) => s !== primaryNext)
                .map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    onClick={() => move(s)}
                    disabled={setStatus.isPending}
                  >
                    {NEXT_LABEL[s] ?? humanize(s)}
                  </Button>
                ))}
              {primaryNext && (
                <Button size="sm" onClick={() => move(primaryNext)} disabled={setStatus.isPending}>
                  {setStatus.isPending ? <Loader2 className="animate-spin" /> : <Check />}{' '}
                  {NEXT_LABEL[primaryNext] ?? humanize(primaryNext)}
                </Button>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="grid gap-6 px-6 pt-5 lg:grid-cols-[1fr_20rem] lg:px-8">
        <div className="grid min-w-0 content-start gap-6">
          <section aria-labelledby="ev-h" className="grid gap-2">
            <div className="flex items-center gap-2">
              <h2 id="ev-h" className="text-sm font-semibold">
                Evidence
              </h2>
              <span className="text-xs text-muted-foreground">
                {bug.attachments.length} file{bug.attachments.length === 1 ? '' : 's'}
              </span>
              {canWrite && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? <Loader2 className="animate-spin" /> : <Plus />} Add file
                </Button>
              )}
              <input
                ref={fileRef}
                type="file"
                hidden
                multiple
                accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,application/pdf,text/plain"
                onChange={(e) => {
                  void upload([...(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
            </div>
            {bug.attachments.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No screenshots or logs yet.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
                {images[0] && (
                  <a href={fileUrl(images[0].id)} target="_blank" rel="noreferrer">
                    <AnnotatedImage
                      src={fileUrl(images[0].id)}
                      alt={images[0].fileName}
                      annotations={images[0].annotations ?? []}
                    />
                  </a>
                )}
                <ul className="grid content-start gap-2">
                  {[...images.slice(1), ...others].map((a) => (
                    <li key={a.id}>
                      <a
                        href={fileUrl(a.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-xs hover:border-primary"
                      >
                        <Paperclip
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{a.fileName}</span>
                          <span className="text-muted-foreground">
                            {a.scanStatus === 'PENDING'
                              ? 'Scanning…'
                              : a.scanStatus === 'INFECTED'
                                ? 'Blocked: failed malware scan'
                                : `${Math.max(1, Math.round(a.size / 1024))} KB`}
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {bug.stepsToReproduce.length > 0 && (
            <section aria-labelledby="st-h" className="grid gap-2">
              <h2 id="st-h" className="text-sm font-semibold">
                Steps to reproduce
              </h2>
              <ol className="grid gap-2">
                {bug.stepsToReproduce.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm">
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
                      aria-hidden
                    >
                      {i + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {(bug.expectedResult || bug.actualResult) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <section className="rounded-xl bg-success-subtle px-3.5 py-2.5">
                <h2 className="text-[11px] font-semibold tracking-wide text-success-text uppercase">
                  Expected
                </h2>
                <p className="mt-0.5 text-sm whitespace-pre-wrap">{bug.expectedResult || '—'}</p>
              </section>
              <section className="rounded-xl bg-destructive-subtle px-3.5 py-2.5">
                <h2 className="text-[11px] font-semibold tracking-wide text-destructive-text uppercase">
                  Actual
                </h2>
                <p className="mt-0.5 text-sm whitespace-pre-wrap">{bug.actualResult || '—'}</p>
              </section>
            </div>
          )}
          {bug.descriptionText && (
            <section className="grid gap-1">
              <h2 className="text-sm font-semibold">Description</h2>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {bug.descriptionText}
              </p>
            </section>
          )}
          <Comments projectId={projectId} bugId={bug.id} canComment={canComment} />
        </div>

        <aside className="grid content-start gap-4" aria-label="Properties">
          <div className="grid gap-3 rounded-xl border bg-card p-4">
            <Prop label="Assignee">
              <Select
                disabled={!canWrite}
                value={bug.assigneeId ?? UNASSIGNED}
                onValueChange={(v) =>
                  patch({ assigneeId: v === UNASSIGNED ? null : v }, 'Assignee updated')
                }
              >
                <SelectTrigger
                  aria-label="Assignee"
                  className="h-8 w-full border-transparent px-2 shadow-none hover:border-input"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {members.data?.map((m) => (
                    <SelectItem key={m.user.id} value={m.user.id}>
                      <span className="flex items-center gap-2">
                        <Avatar name={m.user.name} src={m.user.image} className="size-5" />{' '}
                        {m.user.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Prop>
            <Prop label="Severity">
              <Select
                disabled={!canWrite}
                value={bug.severity}
                onValueChange={(v) => patch({ severity: v as BugSeverity }, 'Severity updated')}
              >
                <SelectTrigger
                  aria-label="Severity"
                  className="h-8 w-full border-transparent px-2 shadow-none hover:border-input"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUG_SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      <SeverityBadge severity={s} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Prop>
            <Prop label="Priority">
              <Select
                disabled={!canWrite}
                value={bug.priority}
                onValueChange={(v) => patch({ priority: v as Priority }, 'Priority updated')}
              >
                <SelectTrigger
                  aria-label="Priority"
                  className="h-8 w-full border-transparent px-2 shadow-none hover:border-input"
                >
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
            </Prop>
            <Prop label="Component">
              <Input
                aria-label="Component"
                disabled={!canWrite}
                defaultValue={bug.component ?? ''}
                placeholder="—"
                className="h-8 border-transparent px-2 shadow-none hover:border-input"
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== bug.component) void patch({ component: v }, 'Component updated');
                }}
              />
            </Prop>
            <Prop label="Environment">
              <span className="block px-2 text-sm leading-snug">
                {[bug.environment?.name, bug.envDetails.browser, bug.envDetails.os]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </span>
            </Prop>
            {bug.envDetails.build && (
              <Prop label="Build">
                <span className="px-2 font-mono text-xs">{bug.envDetails.build}</span>
              </Prop>
            )}
            {bug.envDetails.url && (
              <Prop label="Page">
                <span className="truncate px-2 text-sm" title={bug.envDetails.url}>
                  {bug.envDetails.url}
                </span>
              </Prop>
            )}
            {bug.foundIn && (
              <Prop label="Found in">
                <Link
                  href={`${base}/runs/${bug.foundIn.run.ref}?result=${bug.foundIn.resultId}`}
                  className="truncate px-2 text-sm font-medium hover:underline"
                >
                  {bug.foundIn.run.ref}
                  {bug.foundIn.failedStep && ` · step ${bug.foundIn.failedStep.index + 1}`}
                </Link>
              </Prop>
            )}
            <Prop label="Reporter">
              <span className="px-2 text-sm">{people.get(bug.createdById)?.name ?? '—'}</span>
            </Prop>
          </div>

          {(bug.testCases.length > 0 || bug.duplicateOf || bug.duplicates.length > 0) && (
            <div className="grid gap-2 rounded-xl border bg-card p-4">
              {bug.testCases.length > 0 && (
                <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Linked test cases
                </h2>
              )}
              {bug.testCases.map((t) => (
                <Link
                  key={t.id}
                  href={`${base}/test-cases/${t.ref}`}
                  className="flex items-center gap-2 rounded-lg bg-background px-2 py-1.5 text-xs hover:bg-accent"
                >
                  <span className="font-mono text-muted-foreground">{t.ref}</span>
                  <span className="truncate font-medium">{t.title}</span>
                </Link>
              ))}
              {bug.duplicateOf && (
                <p className="text-xs">
                  Duplicate of{' '}
                  <Link
                    className="font-medium underline"
                    href={`${base}/bugs/${bug.duplicateOf.ref}`}
                  >
                    {bug.duplicateOf.ref}
                  </Link>
                </p>
              )}
              {bug.duplicates.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {bug.duplicates.length} duplicate{bug.duplicates.length === 1 ? '' : 's'}:{' '}
                  {bug.duplicates.map((d) => d.ref).join(', ')}
                </p>
              )}
            </div>
          )}

          {bug.aiGenerated && notes && (
            <section className="grid gap-2 rounded-xl bg-accent p-3.5" aria-label="Bug Agent notes">
              <div className="flex items-center gap-1.5 text-xs">
                <Sparkles className="size-3.5 text-primary" aria-hidden />
                <span className="flex-1 font-semibold">Bug Agent notes</span>
                {notes.confidence != null && (
                  <span className="font-medium text-primary">
                    {Math.round(notes.confidence * 100)}% confident
                  </span>
                )}
              </div>
              {notes.confidence != null && (
                <div className="h-1 overflow-hidden rounded-full bg-card" aria-hidden>
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${notes.confidence * 100}%` }}
                  />
                </div>
              )}
              {notes.rationale && (
                <p className="text-xs text-muted-foreground">{notes.rationale}</p>
              )}
              {notes.duplicates?.map((d) => (
                <Link
                  key={d.ref}
                  href={`${base}/bugs/${d.ref}`}
                  className="flex items-center gap-1.5 rounded-md bg-warning-subtle px-2 py-1.5 text-xs font-medium text-warning-text hover:underline"
                >
                  <Copy className="size-3" aria-hidden /> Possible duplicate: {d.ref} (
                  {Math.round(d.similarity * 100)}%)
                </Link>
              ))}
              {notes.model && (
                <p className="text-[11px] text-muted-foreground">Model: {notes.model}</p>
              )}
            </section>
          )}
        </aside>
      </div>
      {closing && <CloseDialog bug={bug} projectId={projectId} onClose={() => setClosing(false)} />}
    </div>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function CloseDialog({
  bug,
  projectId,
  onClose,
}: {
  bug: BugDetail;
  projectId: string;
  onClose: () => void;
}) {
  const setStatus = useSetBugStatus(projectId);
  const [resolution, setResolution] = useState<BugResolution>('FIXED');
  const [dupRef, setDupRef] = useState('');
  const [error, setError] = useState<string>();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let duplicateOfId: string | null = null;
      if (resolution === 'DUPLICATE') {
        const seq = Number(/(\d+)$/.exec(dupRef.trim())?.[1]);
        if (!seq) return setError('Enter the original bug, e.g. BUG-0007');
        duplicateOfId = (await api.get<BugDetail>(`/v1/projects/${projectId}/bugs/by-ref/${seq}`))
          .id;
      }
      await setStatus.mutateAsync({ id: bug.id, status: 'CLOSED', resolution, duplicateOfId });
      toast.success(`${bug.ref} closed as ${humanize(resolution).toLowerCase()}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close the bug');
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Close {bug.ref}</DialogTitle>
            <DialogDescription>Choose why it’s closed. The reporter is notified.</DialogDescription>
          </DialogHeader>
          <FormField id="close-res" label="Resolution">
            <Select value={resolution} onValueChange={(v) => setResolution(v as BugResolution)}>
              <SelectTrigger id="close-res" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUG_RESOLUTIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {humanize(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {resolution === 'DUPLICATE' && (
            <FormField id="close-dup" label="Duplicate of" error={error}>
              <Input
                id="close-dup"
                value={dupRef}
                onChange={(e) => setDupRef(e.target.value)}
                placeholder="BUG-0007"
              />
            </FormField>
          )}
          {error && resolution !== 'DUPLICATE' && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={setStatus.isPending}>
              {setStatus.isPending && <Loader2 className="animate-spin" />} Close bug
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Comments({
  projectId,
  bugId,
  canComment,
}: {
  projectId: string;
  bugId: string;
  canComment: boolean;
}) {
  const comments = useComments(projectId, 'bug', bugId);
  const add = useAddComment(projectId, 'bug', bugId);
  const [text, setText] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await add.mutateAsync({
        body: {
          type: 'doc',
          content: text
            .trim()
            .split(/\n+/)
            .map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })),
        },
        mentions: [],
      });
      setText('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not post the comment');
    }
  };
  return (
    <section aria-labelledby="act-h" className="grid gap-3">
      <h2 id="act-h" className="text-sm font-semibold">
        Activity
      </h2>
      {comments.isLoading && <Skeleton className="h-14" />}
      {comments.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      )}
      <ol className="grid gap-3">
        {comments.data?.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <Avatar name={c.author.name} src={c.author.image} />
            <div className="min-w-0 flex-1 rounded-xl border bg-card px-3 py-2">
              <p className="flex items-center gap-2 text-xs">
                <span className="font-semibold">{c.author.name}</span>
                <time className="text-muted-foreground" dateTime={c.createdAt}>
                  {new Date(c.createdAt).toLocaleString()}
                </time>
              </p>
              <p className="mt-0.5 text-sm whitespace-pre-wrap">{c.bodyText}</p>
            </div>
          </li>
        ))}
      </ol>
      {canComment && (
        <form onSubmit={submit} className="grid gap-2">
          <label htmlFor="comment" className="sr-only">
            Add a comment
          </label>
          <Textarea
            id="comment"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(e);
            }}
            placeholder="Add a comment (Ctrl+Enter to send)"
          />
          <Button
            type="submit"
            size="sm"
            className="justify-self-end"
            disabled={add.isPending || !text.trim()}
          >
            {add.isPending ? <Loader2 className="animate-spin" /> : <Send />} Comment
          </Button>
        </form>
      )}
    </section>
  );
}
