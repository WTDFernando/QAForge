'use client';
import { useState } from 'react';
import { KeyRound, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
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
import { useSaveEnvironment } from '@/hooks/qa';
import type { EnvironmentRow } from '@/lib/types';

type Pair = { key: string; value: string };

/** Create/edit an environment. Secrets are write-only: existing values are never shown. */
export function EnvironmentDialog({
  projectId,
  env,
  open,
  onOpenChange,
}: {
  projectId: string;
  env: EnvironmentRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{env ? `Edit ${env.name}` : 'New environment'}</DialogTitle>
          <DialogDescription>
            Base URL and variables are visible to the team. Secrets are encrypted and can never be
            read back.
          </DialogDescription>
        </DialogHeader>
        {open && <Form projectId={projectId} env={env} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function PairRows({
  pairs,
  setPairs,
  secret,
}: {
  pairs: Pair[];
  setPairs: (p: Pair[]) => void;
  secret?: boolean;
}) {
  return (
    <div className="grid gap-2">
      {pairs.map((p, i) => (
        <div key={i} className="flex gap-2">
          <Input
            className="h-8 font-mono"
            value={p.key}
            placeholder="NAME"
            aria-label={`${secret ? 'Secret' : 'Variable'} ${i + 1} name`}
            onChange={(e) =>
              setPairs(pairs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))
            }
          />
          <Input
            className="h-8"
            type={secret ? 'password' : 'text'}
            autoComplete="off"
            value={p.value}
            placeholder="value"
            aria-label={`${secret ? 'Secret' : 'Variable'} ${i + 1} value`}
            onChange={(e) =>
              setPairs(pairs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
            }
          />
          <Button
            size="icon-sm"
            variant="ghost"
            type="button"
            onClick={() => setPairs(pairs.filter((_, j) => j !== i))}
            aria-label="Remove"
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        type="button"
        className="w-fit"
        onClick={() => setPairs([...pairs, { key: '', value: '' }])}
      >
        <Plus /> Add
      </Button>
    </div>
  );
}

function Form({
  projectId,
  env,
  onDone,
}: {
  projectId: string;
  env: EnvironmentRow | null;
  onDone: () => void;
}) {
  const save = useSaveEnvironment(projectId);
  const [name, setName] = useState(env?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(env?.baseUrl ?? '');
  const [vars, setVars] = useState<Pair[]>(
    Object.entries(env?.variables ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [secrets, setSecrets] = useState<Pair[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const secretPatch: Record<string, string | null> = Object.fromEntries(
      removed.map((k) => [k, null]),
    );
    for (const s of secrets) if (s.key.trim() && s.value) secretPatch[s.key.trim()] = s.value;
    try {
      await save.mutateAsync({
        id: env?.id,
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        variables: Object.fromEntries(
          vars.filter((v) => v.key.trim()).map((v) => [v.key.trim(), v.value]),
        ),
        ...(Object.keys(secretPatch).length ? { secrets: secretPatch } : {}),
      });
      toast.success(env ? 'Environment updated' : 'Environment created');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save environment');
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="env-name" label="Name">
          <Input
            id="env-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Staging"
          />
        </FormField>
        <FormField id="env-url" label="Base URL">
          <Input
            id="env-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://staging.example.com"
          />
        </FormField>
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Variables</span>
        <PairRows pairs={vars} setPairs={setVars} />
      </div>
      <div className="grid gap-1.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <KeyRound className="size-4" /> Secrets
        </span>
        {env?.secretKeys
          .filter((k) => !removed.includes(k))
          .map((k) => (
            <div key={k} className="flex items-center gap-2 text-sm">
              <span className="flex-1 font-mono">{k}</span>
              <span className="text-muted-foreground">••••••••</span>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={() => setRemoved([...removed, k])}
              >
                Remove
              </Button>
            </div>
          ))}
        <PairRows pairs={secrets} setPairs={setSecrets} secret />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} Save
        </Button>
      </DialogFooter>
    </form>
  );
}
