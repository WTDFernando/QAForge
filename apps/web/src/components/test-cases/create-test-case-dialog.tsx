'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  humanize,
  PRIORITIES,
  TEST_CASE_TYPES,
  type Priority,
  type TestCaseType,
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateTestCase, useSuites } from '@/hooks/qa';

/** Quick create: title (+ optional suite/priority/type), then continue in the full editor. */
export function CreateTestCaseDialog({
  open,
  onOpenChange,
  projectId,
  basePath,
  suiteId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  basePath: string;
  suiteId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New test case</DialogTitle>
          <DialogDescription>
            Add steps, data and requirement links on the next screen.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <Form
            projectId={projectId}
            basePath={basePath}
            suiteId={suiteId}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Form({
  projectId,
  basePath,
  suiteId,
  onDone,
}: {
  projectId: string;
  basePath: string;
  suiteId?: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const create = useCreateTestCase(projectId);
  const suites = useSuites(projectId);
  const [title, setTitle] = useState('');
  const [suite, setSuite] = useState(suiteId && suiteId !== 'none' ? suiteId : 'none');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [type, setType] = useState<TestCaseType>('FUNCTIONAL');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('Enter a title');
    try {
      const tc = await create.mutateAsync({
        title,
        suiteId: suite === 'none' ? null : suite,
        priority,
        type,
      });
      toast.success(`${tc.ref} created`);
      onDone();
      router.push(`${basePath}/test-cases/${tc.ref}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create test case');
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <FormField id="tc-title" label="Title" error={error ?? undefined}>
        <Input
          id="tc-title"
          autoFocus
          value={title}
          onChange={(e) => (setTitle(e.target.value), setError(null))}
          placeholder="e.g. Declined card shows an error"
          aria-invalid={!!error}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="tc-suite" label="Suite">
          <Select value={suite} onValueChange={setSuite}>
            <SelectTrigger id="tc-suite" className="w-full">
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
        </FormField>
        <FormField id="tc-priority" label="Priority">
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
            <SelectTrigger id="tc-priority" className="w-full">
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
        <FormField id="tc-type" label="Type">
          <Select value={type} onValueChange={(v) => setType(v as TestCaseType)}>
            <SelectTrigger id="tc-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEST_CASE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {humanize(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Loader2 className="animate-spin" />} Create and edit
        </Button>
      </DialogFooter>
    </form>
  );
}
