'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bug, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  BUG_SEVERITIES,
  humanize,
  PRIORITIES,
  type BugSeverity,
  type CreateBugInput,
  type Priority,
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
import { FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SeverityBadge } from '@/components/qa/run-status';
import { useCreateBug } from '@/hooks/bugs';

export interface BugFormInitial {
  title?: string;
  stepsToReproduce?: string[];
  expectedResult?: string;
  actualResult?: string;
  severity?: BugSeverity;
  priority?: Priority;
  /** Hidden context sent with the bug (run result, failed step, uploads, AI job). */
  extra?: Partial<CreateBugInput>;
  context?: string;
}

/** New bug / report from a failed step. Steps are one per line. */
export function BugFormDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  basePath: string;
  initial?: BugFormInitial;
  onCreated?: (ref: string) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {/* Mounted per open, so every report starts from `initial`. */}
        {props.open && <BugForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function BugForm({
  onOpenChange,
  projectId,
  basePath,
  initial,
  onCreated,
}: {
  onOpenChange: (o: boolean) => void;
  projectId: string;
  basePath: string;
  initial?: BugFormInitial;
  onCreated?: (ref: string) => void;
}) {
  const router = useRouter();
  const create = useCreateBug(projectId);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [steps, setSteps] = useState<string[]>(
    initial?.stepsToReproduce?.length ? initial.stepsToReproduce : [''],
  );
  const [expected, setExpected] = useState(initial?.expectedResult ?? '');
  const [actual, setActual] = useState(initial?.actualResult ?? '');
  const [severity, setSeverity] = useState<BugSeverity>(initial?.severity ?? 'MAJOR');
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'MEDIUM');
  const [error, setError] = useState<string>();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('Add a title that says what goes wrong where');
    try {
      const bug = await create.mutateAsync({
        ...initial?.extra,
        title: title.trim(),
        stepsToReproduce: steps.map((s) => s.trim()).filter(Boolean),
        expectedResult: expected,
        actualResult: actual,
        severity,
        priority,
      });
      toast.success(`${bug.ref} reported`, {
        action: { label: 'Open', onClick: () => router.push(`${basePath}/bugs/${bug.ref}`) },
      });
      onCreated?.(bug.ref);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the bug');
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Bug className="size-4 text-destructive" aria-hidden /> Report a bug
        </DialogTitle>
        <DialogDescription>
          {initial?.context ?? 'Describe what goes wrong so a developer can reproduce it.'}
        </DialogDescription>
      </DialogHeader>
      <FormField id="bug-title" label="Title" error={error}>
        <Input
          id="bug-title"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Checkout total ignores discount code on the payment step"
        />
      </FormField>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Steps to reproduce</legend>
        <ol className="grid gap-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                aria-hidden
              >
                {i + 1}
              </span>
              <Input
                aria-label={`Step ${i + 1}`}
                value={s}
                onChange={(e) => setSteps(steps.map((x, j) => (j === i ? e.target.value : x)))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setSteps([...steps.slice(0, i + 1), '', ...steps.slice(i + 1)]);
                  }
                }}
              />
              {steps.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove step ${i + 1}`}
                  onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ol>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() => setSteps([...steps, ''])}
        >
          <Plus /> Add step
        </Button>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="bug-expected" label="Expected">
          <Textarea
            id="bug-expected"
            rows={3}
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        </FormField>
        <FormField id="bug-actual" label="Actual">
          <Textarea
            id="bug-actual"
            rows={3}
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
        </FormField>
        <FormField id="bug-severity" label="Severity">
          <Select value={severity} onValueChange={(v) => setSeverity(v as BugSeverity)}>
            <SelectTrigger id="bug-severity" className="w-full">
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
        <FormField id="bug-priority" label="Priority">
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
            <SelectTrigger id="bug-priority" className="w-full">
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
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Bug />} Create bug
        </Button>
      </DialogFooter>
    </form>
  );
}
