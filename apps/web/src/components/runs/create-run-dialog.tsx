'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderTree, Loader2, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { humanize, TEST_CASE_STATUSES, type TestCaseStatus } from '@qaforge/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEnvironments, useSuites } from '@/hooks/qa';
import { useMembers } from '@/hooks/queries';
import { useCreateTestRun } from '@/hooks/runs';
import { cn } from '@/lib/utils';

const NONE = '__none';

/** Plan a run: what to test (a suite or a filter), where (environment + build), who and by when. */
export function CreateRunDialog({
  open,
  onOpenChange,
  projectId,
  orgId,
  basePath,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  orgId: string;
  basePath: string;
}) {
  const router = useRouter();
  const create = useCreateTestRun(projectId);
  const suites = useSuites(open ? projectId : undefined);
  const envs = useEnvironments(open ? projectId : undefined);
  const members = useMembers(open ? orgId : undefined);
  const [name, setName] = useState('');
  const [source, setSource] = useState<'suite' | 'filter'>('suite');
  const [suiteId, setSuiteId] = useState('');
  const [statuses, setStatuses] = useState<TestCaseStatus[]>(['APPROVED']);
  const [envId, setEnvId] = useState(NONE);
  const [build, setBuild] = useState('');
  const [assignee, setAssignee] = useState(NONE);
  const [due, setDue] = useState('');
  const [error, setError] = useState<string>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Give the run a name');
    if (source === 'suite' && !suiteId) return setError('Choose a suite');
    try {
      const run = await create.mutateAsync({
        name: name.trim(),
        description: '',
        selection:
          source === 'suite'
            ? { kind: 'suite', suiteId, deep: true }
            : { kind: 'filter', status: statuses.length ? statuses : undefined },
        onlyApproved: false,
        environmentId: envId === NONE ? null : envId,
        build: build.trim() || null,
        assigneeId: assignee === NONE ? null : assignee,
        dueAt: due ? new Date(`${due}T17:00:00`).toISOString() : null,
      });
      toast.success(`${run.ref} created with ${run.counts.total} tests`);
      onOpenChange(false);
      router.push(`${basePath}/runs/${run.ref}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the run');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>New test run</DialogTitle>
            <DialogDescription>
              Results are recorded against a snapshot, so later edits to the cases don’t change this
              run.
            </DialogDescription>
          </DialogHeader>
          <FormField id="run-name" label="Name" error={error && !name.trim() ? error : undefined}>
            <Input
              id="run-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Release 2.4 regression"
            />
          </FormField>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Tests to include</legend>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tests to include">
              {(
                [
                  ['suite', FolderTree, 'From a suite', 'Includes sub-suites'],
                  ['filter', SlidersHorizontal, 'By status', 'Every case that matches'],
                ] as const
              ).map(([v, Icon, title, hint]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={source === v}
                  onClick={() => setSource(v)}
                  className={cn(
                    'flex items-start gap-2 rounded-lg border p-3 text-left text-sm transition-colors',
                    source === v ? 'border-primary bg-primary-subtle' : 'hover:bg-accent',
                  )}
                >
                  <Icon
                    className={cn(
                      'mt-0.5 size-4',
                      source === v ? 'text-primary' : 'text-muted-foreground',
                    )}
                    aria-hidden
                  />
                  <span>
                    <span className="block font-medium">{title}</span>
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
            {source === 'suite' ? (
              <Select value={suiteId} onValueChange={setSuiteId}>
                <SelectTrigger aria-label="Suite" className="w-full">
                  <SelectValue
                    placeholder={suites.isLoading ? 'Loading suites…' : 'Choose a suite'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {suites.data?.suites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · {s.caseCount}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex flex-wrap gap-3" role="group" aria-label="Case status">
                {TEST_CASE_STATUSES.filter((s) => s !== 'DEPRECATED').map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={statuses.includes(s)}
                      onCheckedChange={(c) =>
                        setStatuses(c === true ? [...statuses, s] : statuses.filter((x) => x !== s))
                      }
                    />
                    {humanize(s)}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="run-env" label="Environment">
              <Select value={envId} onValueChange={setEnvId}>
                <SelectTrigger id="run-env" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {envs.data?.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField id="run-build" label="Build">
              <Input
                id="run-build"
                value={build}
                onChange={(e) => setBuild(e.target.value)}
                placeholder="2.4.0-rc1"
              />
            </FormField>
            <FormField id="run-assignee" label="Assign everything to">
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger id="run-assignee" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nobody yet</SelectItem>
                  {members.data?.map((m) => (
                    <SelectItem key={m.user.id} value={m.user.id}>
                      {m.user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField id="run-due" label="Due">
              <Input
                id="run-due"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </FormField>
          </div>
          {error && name.trim() && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />} Create run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
