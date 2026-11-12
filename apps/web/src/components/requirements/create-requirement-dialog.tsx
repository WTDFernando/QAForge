'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  humanize,
  PRIORITIES,
  REQUIREMENT_TYPES,
  type Priority,
  type RequirementType,
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
import { useCreateRequirement } from '@/hooks/qa';
import type { RequirementRow } from '@/lib/types';

const CHILD_TYPE: Record<RequirementType, RequirementType> = {
  EPIC: 'FEATURE',
  FEATURE: 'STORY',
  STORY: 'STORY',
};
const RANK: Record<RequirementType, number> = { EPIC: 0, FEATURE: 1, STORY: 2 };

export function CreateRequirementDialog({
  open,
  onOpenChange,
  projectId,
  basePath,
  parent,
  requirements,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  basePath: string;
  parent: RequirementRow | null;
  requirements: RequirementRow[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New requirement</DialogTitle>
          <DialogDescription>
            Epics contain features, features contain user stories.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <Form
            projectId={projectId}
            basePath={basePath}
            parent={parent}
            requirements={requirements}
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
  parent,
  requirements,
  onDone,
}: {
  projectId: string;
  basePath: string;
  parent: RequirementRow | null;
  requirements: RequirementRow[];
  onDone: () => void;
}) {
  const router = useRouter();
  const create = useCreateRequirement(projectId);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<RequirementType>(parent ? CHILD_TYPE[parent.type] : 'STORY');
  const [parentId, setParentId] = useState<string>(
    parent && parent.type !== 'STORY' ? parent.id : 'none',
  );
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [error, setError] = useState<string | null>(null);
  const parents = requirements.filter((r) => RANK[r.type] < RANK[type]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('Enter a title');
    try {
      const r = await create.mutateAsync({
        title,
        type,
        priority,
        parentId: parentId === 'none' ? null : parentId,
      });
      toast.success(`${r.ref} created`);
      onDone();
      router.push(`${basePath}/requirements/${r.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create requirement');
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <FormField id="req-title" label="Title" error={error ?? undefined}>
        <Input
          id="req-title"
          autoFocus
          value={title}
          onChange={(e) => (setTitle(e.target.value), setError(null))}
          placeholder="e.g. Shopper can pay with a saved card"
          aria-invalid={!!error}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="req-type" label="Type">
          <Select
            value={type}
            onValueChange={(v) => {
              setType(v as RequirementType);
              setParentId('none');
            }}
          >
            <SelectTrigger id="req-type" className="w-full">
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
        </FormField>
        <FormField id="req-priority" label="Priority">
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
            <SelectTrigger id="req-priority" className="w-full">
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
        <FormField id="req-parent" label="Parent">
          <Select value={parentId} onValueChange={setParentId} disabled={type === 'EPIC'}>
            <SelectTrigger id="req-parent" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (top level)</SelectItem>
              {parents.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.ref} · {r.title}
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
          {create.isPending && <Loader2 className="animate-spin" />} Create
        </Button>
      </DialogFooter>
    </form>
  );
}
