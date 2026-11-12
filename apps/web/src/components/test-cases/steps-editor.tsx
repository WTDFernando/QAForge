'use client';
import { useState } from 'react';
import { ArrowDown, ArrowUp, Link2, Plus, Repeat2, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input, Textarea } from '@/components/ui/input';
import { useCreateSharedStep, useSharedSteps } from '@/hooks/qa';
import type { SharedStepRow } from '@/lib/types';

export interface DraftStep {
  key: string;
  action: string;
  expected: string;
  sharedStepId: string | null;
}

let k = 0;
export const newStep = (s: Partial<DraftStep> = {}): DraftStep => ({
  key: `s${++k}`,
  action: '',
  expected: '',
  sharedStepId: null,
  ...s,
});

export function StepsEditor({
  projectId,
  steps,
  onChange,
  editable,
}: {
  projectId: string;
  steps: DraftStep[];
  onChange: (s: DraftStep[]) => void;
  editable: boolean;
}) {
  const shared = useSharedSteps(projectId);
  const createShared = useCreateSharedStep(projectId);
  const sharedById = new Map((shared.data ?? []).map((s) => [s.id, s]));

  const update = (i: number, patch: Partial<DraftStep>) =>
    onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s!);
    onChange(next);
  };

  const [naming, setNaming] = useState<string | null>(null);
  const saveAsShared = async (e: React.FormEvent) => {
    e.preventDefault();
    const plain = steps.filter((s) => !s.sharedStepId && (s.action || s.expected));
    const name = naming?.trim();
    if (!name || plain.length === 0) return;
    try {
      await createShared.mutateAsync({
        name,
        steps: plain.map(({ action, expected }) => ({ action, expected })),
      });
      toast.success(`Shared step "${name}" created`, {
        description: 'Insert it into any test case from "Insert shared step".',
      });
      setNaming(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create shared step');
    }
  };

  return (
    <div className="grid gap-2">
      <div className="hidden grid-cols-[2rem_1fr_1fr_5.5rem] gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid">
        <span>#</span>
        <span>Action</span>
        <span>Expected result</span>
        <span />
      </div>
      <ol className="grid gap-2">
        {steps.map((s, i) => {
          const sh: SharedStepRow | undefined = s.sharedStepId
            ? sharedById.get(s.sharedStepId)
            : undefined;
          return (
            <li
              key={s.key}
              className="grid grid-cols-[2rem_1fr] gap-2 rounded-lg border p-2 sm:grid-cols-[2rem_1fr_1fr_5.5rem] sm:border-0 sm:p-0"
            >
              <span className="pt-2 text-center text-sm font-semibold text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              {s.sharedStepId ? (
                <div className="rounded-md border border-dashed bg-muted/30 p-2 text-sm sm:col-span-2">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Repeat2 className="size-4 text-primary" /> Shared: {sh?.name ?? 'Loading…'}
                  </div>
                  <ol className="mt-1 list-decimal pl-8 text-xs text-muted-foreground">
                    {sh?.steps.map((x, j) => (
                      <li key={j}>
                        {x.action} <span className="text-foreground/70">→ {x.expected}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <>
                  <Textarea
                    className="min-h-16 text-sm"
                    value={s.action}
                    readOnly={!editable}
                    onChange={(e) => update(i, { action: e.target.value })}
                    placeholder="What the tester does"
                    aria-label={`Step ${i + 1} action`}
                  />
                  <Textarea
                    className="col-start-2 min-h-16 text-sm sm:col-start-auto"
                    value={s.expected}
                    readOnly={!editable}
                    onChange={(e) => update(i, { expected: e.target.value })}
                    placeholder="What should happen"
                    aria-label={`Step ${i + 1} expected result`}
                  />
                </>
              )}
              {editable && (
                <div className="col-start-2 flex gap-0.5 sm:col-start-auto sm:flex-col sm:items-start">
                  <div className="flex">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label={`Move step ${i + 1} up`}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={i === steps.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={`Move step ${i + 1} down`}
                    >
                      <ArrowDown />
                    </Button>
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => onChange(steps.filter((_, j) => j !== i))}
                    aria-label={`Delete step ${i + 1}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {steps.length === 0 && (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          No steps yet. Each step pairs an action with its expected result.
        </p>
      )}
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onChange([...steps, newStep()])}>
            <Plus /> Add step
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <Link2 /> Insert shared step
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64">
              <DropdownMenuLabel>Shared steps</DropdownMenuLabel>
              {(shared.data ?? []).length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  None yet. Save common steps (like logging in) as a shared step to reuse them.
                </p>
              )}
              {shared.data?.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onSelect={() => onChange([...steps, newStep({ sharedStepId: s.id })])}
                >
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{s.steps.length} steps</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setNaming('')}
                disabled={!steps.some((s) => !s.sharedStepId && s.action)}
              >
                <Save /> Save these steps as shared…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {naming !== null && (
        <form onSubmit={saveAsShared} className="flex gap-2 rounded-lg border bg-muted/30 p-2">
          <Input
            autoFocus
            className="h-8"
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            placeholder='Name, e.g. "Log in as admin"'
            aria-label="Shared step name"
            onKeyDown={(e) => e.key === 'Escape' && setNaming(null)}
          />
          <Button size="sm" type="submit" disabled={!naming.trim() || createShared.isPending}>
            Save shared step
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setNaming(null)}>
            Cancel
          </Button>
        </form>
      )}
    </div>
  );
}
