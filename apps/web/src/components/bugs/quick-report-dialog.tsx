'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bug, Camera, Copy, Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  BUG_SEVERITIES,
  humanize,
  PRIORITIES,
  type BugSeverity,
  type Priority,
} from '@qaforge/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SeverityBadge } from '@/components/qa/run-status';
import { useAgentJob, useBugUpload, useCreateBug, useStartBugDraft } from '@/hooks/bugs';
import { useEnvironments } from '@/hooks/qa';
import type { AttachmentRow, BugDraft } from '@/lib/types';
import { AnnotatedImage } from './annotated-image';

const NONE = '__none';
const ENV_LABEL: Record<string, string> = {
  os: 'OS',
  url: 'Page',
  browser: 'Browser',
  device: 'Device',
  viewport: 'Viewport',
  build: 'Build',
};

/**
 * Quick report (Figma: "04 Quick report"). Capture → Bug Agent drafts → the tester reviews and
 * creates. Nothing is filed until "Create bug".
 */
export function QuickReportDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  basePath: string;
  aiReady: boolean;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        {/* Mounted per open: every report starts empty. */}
        {props.open && <QuickReport {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function QuickReport({
  open,
  onOpenChange,
  projectId,
  basePath,
  aiReady,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  basePath: string;
  aiReady: boolean;
}) {
  const upload = useBugUpload(projectId);
  const start = useStartBugDraft(projectId);
  const envs = useEnvironments(open ? projectId : undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [pageUrl, setPageUrl] = useState('');
  const [envId, setEnvId] = useState(NONE);
  const [shot, setShot] = useState<AttachmentRow | null>(null);
  const [jobId, setJobId] = useState<string>();
  const job = useAgentJob<BugDraft>(projectId, jobId, true);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  // Paste a screenshot anywhere in the dialog.
  useEffect(() => {
    if (!open || jobId) return;
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (f) {
        e.preventDefault();
        setFile(f);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open, jobId]);

  const output = job.data?.status === 'SUCCEEDED' ? job.data.output : null;

  const draft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (note.trim().length < 3) return toast.error('Add a short note about what went wrong');
    try {
      const att = file ? await upload.mutateAsync(file) : null;
      setShot(att);
      const j = await start.mutateAsync({
        kind: 'draft-bug',
        note: note.trim(),
        attachmentId: att?.id,
        pageUrl: pageUrl.trim() || undefined,
        userAgent: navigator.userAgent,
        environmentId: envId === NONE ? undefined : envId,
      });
      setJobId(j.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the Bug Agent');
    }
  };

  const running =
    !!jobId && (!job.data || job.data.status === 'QUEUED' || job.data.status === 'RUNNING');
  const failed = job.data?.status === 'FAILED' || job.data?.status === 'CANCELLED';

  return (
    <>
      <DialogHeader className="flex-row items-center gap-3 border-b px-5 py-4 text-left">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary-subtle text-primary">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div>
          <DialogTitle>Quick report</DialogTitle>
          <DialogDescription>
            {output
              ? 'Bug Agent drafted this from your screenshot. Check it, then create the bug.'
              : 'Add a screenshot and one line. The Bug Agent writes the full report for you to check.'}
          </DialogDescription>
        </div>
      </DialogHeader>

      {!jobId ? (
        <form onSubmit={draft} className="grid gap-4 p-5">
          {!aiReady && (
            <p
              role="status"
              className="rounded-lg bg-warning-subtle px-3 py-2 text-sm text-warning-text"
            >
              AI is turned off or not set up for this organization. Use New bug to write the report
              yourself.
            </p>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
              if (f) setFile(f);
            }}
            className="relative flex min-h-44 flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed p-4 text-center hover:border-primary hover:bg-accent/40"
            aria-label={file ? `Screenshot: ${file.name}. Click to replace.` : 'Add a screenshot'}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="max-h-64 rounded-md object-contain" />
            ) : (
              <>
                <Camera className="size-6 text-muted-foreground" aria-hidden />
                <span className="text-sm font-medium">
                  Drop a screenshot, click to choose, or paste
                </span>
                <span className="text-xs text-muted-foreground">
                  <Kbd>Ctrl V</Kbd> · PNG, JPEG or WebP · optional but recommended
                </span>
              </>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-mt-2 justify-self-start"
              onClick={() => setFile(null)}
            >
              <X /> Remove screenshot
            </Button>
          )}
          <FormField id="qr-note" label="What went wrong?">
            <Textarea
              id="qr-note"
              rows={2}
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Pay button overlaps the total on iPhone SE"
            />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="qr-url" label="Page URL (optional)">
              <Input
                id="qr-url"
                value={pageUrl}
                onChange={(e) => setPageUrl(e.target.value)}
                placeholder="https://staging.example.com/checkout"
              />
            </FormField>
            <FormField id="qr-env" label="Environment">
              <Select value={envId} onValueChange={setEnvId}>
                <SelectTrigger id="qr-env" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not specified</SelectItem>
                  {envs.data?.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <p className="text-xs text-muted-foreground">
            Passwords, tokens and environment secrets are removed before anything is sent to the AI.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!aiReady || upload.isPending || start.isPending}>
              {upload.isPending || start.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Sparkles />
              )}{' '}
              Draft with Bug Agent
            </Button>
          </div>
        </form>
      ) : running || (!output && !failed) ? (
        <div
          className="grid place-items-center gap-3 px-5 py-16 text-center"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
          <p className="text-sm font-medium">
            {job.data?.progressMessage ?? 'Bug Agent is reading your screenshot…'}
          </p>
          <div className="h-1.5 w-56 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${job.data?.progress ?? 5}%` }}
            />
          </div>
        </div>
      ) : failed ? (
        <div className="grid place-items-center gap-3 px-5 py-14 text-center" role="alert">
          <p className="text-sm font-medium">The Bug Agent couldn’t draft this report.</p>
          <p className="max-w-md text-sm text-muted-foreground">{job.data?.error}</p>
          <Button variant="outline" onClick={() => setJobId(undefined)}>
            Back
          </Button>
        </div>
      ) : output ? (
        <DraftReview
          output={output}
          jobId={jobId}
          shot={shot}
          preview={preview}
          note={note}
          projectId={projectId}
          basePath={basePath}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </>
  );
}

function DraftReview({
  output,
  jobId,
  shot,
  preview,
  note,
  projectId,
  basePath,
  onDone,
}: {
  output: BugDraft;
  jobId: string;
  shot: AttachmentRow | null;
  preview: string | null;
  note: string;
  projectId: string;
  basePath: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const create = useCreateBug(projectId);
  const [form, setForm] = useState({
    title: output.draft.title,
    steps: output.draft.stepsToReproduce.join('\n'),
    expected: output.draft.expectedResult,
    actual: output.draft.actualResult,
    severity: output.draft.severity as BugSeverity,
    priority: output.draft.priority as Priority,
  });
  const submit = async () => {
    try {
      const d = output.draft;
      const bug = await create.mutateAsync({
        title: form.title.trim(),
        stepsToReproduce: form.steps
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        expectedResult: form.expected,
        actualResult: form.actual,
        severity: form.severity,
        priority: form.priority,
        component: d.component,
        envDetails: d.envDetails,
        environmentId: d.environmentId,
        aiJobId: jobId,
        attachmentIds: shot ? [shot.id] : [],
        attachmentAnnotations: shot ? { [shot.id]: d.annotations } : {},
      });
      toast.success(`${bug.ref} created`, {
        action: { label: 'Open', onClick: () => router.push(`${basePath}/bugs/${bug.ref}`) },
      });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the bug');
    }
  };

  return (
    <>
      <div className="grid gap-5 p-5 md:grid-cols-[17rem_1fr]">
        <div className="grid content-start gap-3">
          {shot && preview ? (
            <AnnotatedImage
              src={preview}
              alt="Your screenshot with the problem highlighted"
              annotations={output.draft.annotations}
            />
          ) : (
            <div className="rounded-lg bg-muted p-4 text-center text-xs text-muted-foreground">
              No screenshot
            </div>
          )}
          <div className="grid gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Your note</span>
            <p className="rounded-lg border bg-background px-3 py-2 text-sm">{note}</p>
          </div>
          {Object.keys(output.draft.envDetails).length > 0 && (
            <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 rounded-lg bg-muted px-3 py-2.5 text-xs">
              {Object.entries(output.draft.envDetails).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{ENV_LABEL[k] ?? humanize(k)}</dt>
                  <dd className="truncate font-medium" title={v}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="grid content-start gap-3.5">
          <p className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-primary">
            <Sparkles className="size-3.5" aria-hidden />
            {Math.round(output.confidence * 100)}% confident
            {output.draft.annotations.length > 0 && ' · highlight added to the screenshot'}
          </p>
          <FormField id="qr-title" label="Title">
            <Input
              id="qr-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </FormField>
          <FormField
            id="qr-steps"
            label="Steps to reproduce"
            hint="One step per line. Text in [brackets] is a placeholder to fill in."
          >
            <Textarea
              id="qr-steps"
              rows={4}
              value={form.steps}
              onChange={(e) => setForm({ ...form, steps: e.target.value })}
            />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="qr-expected" label="Expected">
              <Textarea
                id="qr-expected"
                rows={2}
                value={form.expected}
                onChange={(e) => setForm({ ...form, expected: e.target.value })}
              />
            </FormField>
            <FormField id="qr-actual" label="Actual">
              <Textarea
                id="qr-actual"
                rows={2}
                value={form.actual}
                onChange={(e) => setForm({ ...form, actual: e.target.value })}
              />
            </FormField>
            <FormField id="qr-sev" label="Severity">
              <Select
                value={form.severity}
                onValueChange={(v) => setForm({ ...form, severity: v as BugSeverity })}
              >
                <SelectTrigger id="qr-sev" className="w-full">
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
            </FormField>
            <FormField id="qr-pri" label="Priority">
              <Select
                value={form.priority}
                onValueChange={(v) => setForm({ ...form, priority: v as Priority })}
              >
                <SelectTrigger id="qr-pri" className="w-full">
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
            </FormField>
          </div>
          {output.duplicates.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3 rounded-lg bg-warning-subtle px-3 py-2.5 text-warning-text"
            >
              <Copy className="size-4 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1 text-xs">
                <p className="font-semibold">Possible duplicate: {d.ref}</p>
                <p className="truncate">
                  “{d.title}” · {humanize(d.status)} · {Math.round(d.similarity * 100)}% similar
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`${basePath}/bugs/${d.ref}`} target="_blank">
                  Open
                </Link>
              </Button>
            </div>
          ))}
          {output.missingInfo.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <p className="font-semibold">The agent needs from you</p>
              <ul className="mt-1 list-disc pl-4">
                {output.missingInfo.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t bg-background px-5 py-3">
        <p className="mr-auto text-xs text-muted-foreground">
          Nothing is filed until you select Create bug.
        </p>
        <Button variant="ghost" onClick={onDone}>
          Discard
        </Button>
        <Button onClick={submit} disabled={create.isPending || !form.title.trim()}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Bug />} Create bug
        </Button>
      </div>
    </>
  );
}
