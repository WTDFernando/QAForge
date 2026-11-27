'use client';
import { useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import {
  BUG_SEVERITIES,
  GATE_METRIC_INFO,
  GATE_METRICS,
  hasPermission,
  type GateInput,
  type GateMetric,
  type GateOperator,
} from '@qaforge/shared';
import { Avatar } from '@/components/ui/avatar';
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
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { useBugList } from '@/hooks/bugs';
import {
  useDecide,
  useReleaseScope,
  useSetApprovers,
  useSetGates,
  type ReleaseDetail,
} from '@/hooks/releases';
import { useRequirements } from '@/hooks/qa';
import { useCurrentOrg, useMembers } from '@/hooks/queries';
import { useTestRuns } from '@/hooks/runs';
import { cn } from '@/lib/utils';

const OP_LABEL: Record<GateOperator, string> = { GTE: 'at least', LTE: 'at most', EQ: 'exactly' };

export function GatesDialog({
  projectId,
  release,
  onClose,
}: {
  projectId: string;
  release: ReleaseDetail;
  onClose: () => void;
}) {
  const [gates, setGates] = useState<GateInput[]>(
    release.gates.map(({ metric, operator, threshold, params, blocking }) => ({
      metric,
      operator,
      threshold,
      params,
      blocking,
    })),
  );
  const save = useSetGates(projectId, release.id);
  const set = (i: number, patch: Partial<GateInput>) =>
    setGates((g) => g.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Quality gates</DialogTitle>
          <DialogDescription>
            Rules the release must meet. Blocking gates must pass before anyone can be asked for
            approval.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2" aria-label="Gates">
          {gates.map((g, i) => {
            const info = GATE_METRIC_INFO[g.metric];
            return (
              <li key={i} className="grid gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={`Gate ${i + 1} metric`}
                    value={g.metric}
                    onChange={(e) => {
                      const metric = e.target.value as GateMetric;
                      set(i, {
                        metric,
                        operator: metric === 'OPEN_BUGS' ? 'LTE' : 'GTE',
                        threshold: metric === 'OPEN_BUGS' ? 0 : 90,
                        params:
                          metric === 'OPEN_BUGS' ? { severities: ['BLOCKER', 'CRITICAL'] } : {},
                      });
                    }}
                    className="h-9 min-w-52 flex-1 rounded-md border bg-background px-2 text-sm"
                  >
                    {GATE_METRICS.map((m) => (
                      <option key={m} value={m}>
                        {GATE_METRIC_INFO[m].label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Gate ${i + 1} comparison`}
                    value={g.operator}
                    onChange={(e) => set(i, { operator: e.target.value as GateOperator })}
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                  >
                    {(['GTE', 'LTE', 'EQ'] as const).map((o) => (
                      <option key={o} value={o}>
                        {OP_LABEL[o]}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    min={0}
                    max={info.unit === '%' ? 100 : 10000}
                    aria-label={`Gate ${i + 1} threshold`}
                    value={g.threshold}
                    onChange={(e) => set(i, { threshold: Number(e.target.value) })}
                    className="h-9 w-24 font-mono"
                  />
                  <span className="text-sm text-muted-foreground">{info.unit}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove gate ${i + 1}`}
                    onClick={() => setGates((x) => x.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{info.description}</p>
                {g.metric === 'OPEN_BUGS' && (
                  <fieldset className="flex flex-wrap gap-3 text-sm">
                    <legend className="sr-only">Severities counted</legend>
                    {BUG_SEVERITIES.map((s) => (
                      <label key={s} className="flex items-center gap-1.5">
                        <Checkbox
                          checked={g.params.severities?.includes(s) ?? false}
                          onCheckedChange={(v) => {
                            const cur = g.params.severities ?? [];
                            set(i, {
                              params: {
                                ...g.params,
                                severities: v ? [...cur, s] : cur.filter((x) => x !== s),
                              },
                            });
                          }}
                        />
                        {s.charAt(0) + s.slice(1).toLowerCase()}
                      </label>
                    ))}
                  </fieldset>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={g.blocking}
                    onCheckedChange={(v) => set(i, { blocking: v === true })}
                  />
                  Blocking (must pass before approval)
                </label>
              </li>
            );
          })}
        </ul>
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          disabled={gates.length >= 20}
          onClick={() =>
            setGates((g) => [
              ...g,
              { metric: 'PASS_RATE', operator: 'GTE', threshold: 95, params: {}, blocking: true },
            ])
          }
        >
          <Plus /> Add gate
        </Button>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate(gates, { onSuccess: onClose })}
            disabled={save.isPending}
          >
            Save gates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ScopeKind = 'requirements' | 'testRuns' | 'bugs';

/** Pick requirements, runs or bugs to add to the release. */
export function ScopeDialog({
  projectId,
  release,
  kind,
  onClose,
}: {
  projectId: string;
  release: ReleaseDetail;
  kind: ScopeKind;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const reqs = useRequirements(kind === 'requirements' ? projectId : undefined);
  const runs = useTestRuns(kind === 'testRuns' ? projectId : undefined);
  const bugs = useBugList(
    kind === 'bugs' ? projectId : undefined,
    'status=NEW,TRIAGED,IN_PROGRESS,FIXED,READY_FOR_RETEST,REOPENED',
  );
  const scope = useReleaseScope(projectId, release.id);
  const query = kind === 'requirements' ? reqs : kind === 'testRuns' ? runs : bugs;
  const existing = useMemo(
    () =>
      new Set(
        kind === 'requirements'
          ? release.requirements.map((r) => r.id)
          : kind === 'testRuns'
            ? release.testRuns.map((r) => r.id)
            : release.bugs.filter((b) => b.inScope).map((b) => b.id),
      ),
    [kind, release],
  );
  const options = useMemo(() => {
    const list: { id: string; ref: string; title: string; meta: string; disabled?: string }[] =
      kind === 'requirements'
        ? (reqs.data ?? [])
            .filter((r) => r.type !== 'EPIC')
            .map((r) => ({ id: r.id, ref: r.ref, title: r.title, meta: r.priority.toLowerCase() }))
        : kind === 'testRuns'
          ? (runs.data?.items ?? []).map((r) => ({
              id: r.id,
              ref: r.ref,
              title: r.name,
              meta: r.status.toLowerCase().replace('_', ' '),
              disabled:
                r.releaseId && r.releaseId !== release.id ? 'In another release' : undefined,
            }))
          : (bugs.data?.items ?? []).map((b) => ({
              id: b.id,
              ref: b.ref,
              title: b.title,
              meta: b.severity.toLowerCase(),
            }));
    const needle = q.trim().toLowerCase();
    return list.filter(
      (o) =>
        !existing.has(o.id) && (!needle || `${o.ref} ${o.title}`.toLowerCase().includes(needle)),
    );
  }, [kind, reqs.data, runs.data, bugs.data, q, existing, release.id]);
  const label = { requirements: 'requirements', testRuns: 'test runs', bugs: 'bugs' }[kind];
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add {label}</DialogTitle>
          <DialogDescription>
            {kind === 'testRuns'
              ? 'Results of these runs count toward the release gates.'
              : kind === 'bugs'
                ? 'Bugs found in the release runs are included automatically; add others that must be fixed for this release.'
                : 'Coverage is measured on these requirements.'}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${label}`}
            aria-label={`Search ${label}`}
            className="pl-8"
          />
        </div>
        <div className="max-h-80 overflow-auto rounded-lg border">
          {query.isError ? (
            <ErrorState error={query.error} what={label} />
          ) : query.isPending ? (
            <div className="grid gap-2 p-3">
              <Skeleton className="h-6" />
              <Skeleton className="h-6" />
            </div>
          ) : options.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Nothing to add.</p>
          ) : (
            <ul aria-label={label}>
              {options.map((o) => (
                <li key={o.id} className="border-b last:border-b-0">
                  <label
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 text-sm',
                      o.disabled ? 'opacity-60' : 'cursor-pointer hover:bg-accent',
                    )}
                  >
                    <Checkbox
                      checked={picked.has(o.id)}
                      disabled={!!o.disabled}
                      onCheckedChange={() => toggle(o.id)}
                    />
                    <span className="font-mono text-xs text-muted-foreground">{o.ref}</span>
                    <span className="min-w-0 flex-1 truncate">{o.title}</span>
                    <span className="text-xs text-muted-foreground">{o.disabled ?? o.meta}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!picked.size || scope.isPending}
            onClick={() =>
              scope.mutate(
                {
                  add: {
                    requirementIds: kind === 'requirements' ? [...picked] : [],
                    testRunIds: kind === 'testRuns' ? [...picked] : [],
                    bugIds: kind === 'bugs' ? [...picked] : [],
                  },
                },
                { onSuccess: onClose },
              )
            }
          >
            Add {picked.size || ''} {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ApproversDialog({
  projectId,
  release,
  onClose,
}: {
  projectId: string;
  release: ReleaseDetail;
  onClose: () => void;
}) {
  const { org } = useCurrentOrg();
  const members = useMembers(org?.id);
  const [rows, setRows] = useState(
    release.approvals.map((a) => ({ userId: a.approver.id, roleLabel: a.roleLabel })),
  );
  const save = useSetApprovers(projectId, release.id);
  // Only roles that can approve releases are offered (project overrides are checked by the API).
  const eligible = (members.data ?? []).filter((m) => hasPermission(m.role, 'release:approve'));
  const DEFAULT_LABEL: Record<string, string> = {
    QA_LEAD: 'QA Lead',
    CLIENT: 'Client',
    ADMIN: 'Admin',
    OWNER: 'Owner',
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Approvers</DialogTitle>
          <DialogDescription>
            Everyone named here must approve before the release can ship.
          </DialogDescription>
        </DialogHeader>
        {members.isPending ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="grid gap-2" aria-label="People who can approve">
            {eligible.map((m) => {
              const row = rows.find((r) => r.userId === m.user.id);
              return (
                <li key={m.id} className="flex items-center gap-3 rounded-lg border p-2">
                  <Checkbox
                    aria-label={`Approver: ${m.user.name}`}
                    checked={!!row}
                    onCheckedChange={(v) =>
                      setRows((r) =>
                        v
                          ? [
                              ...r,
                              { userId: m.user.id, roleLabel: DEFAULT_LABEL[m.role] ?? 'Approver' },
                            ]
                          : r.filter((x) => x.userId !== m.user.id),
                      )
                    }
                  />
                  <Avatar name={m.user.name} src={m.user.image} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.user.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.user.email}
                    </span>
                  </span>
                  {row && (
                    <Input
                      aria-label={`Signs as (${m.user.name})`}
                      value={row.roleLabel}
                      onChange={(e) =>
                        setRows((r) =>
                          r.map((x) =>
                            x.userId === m.user.id ? { ...x, roleLabel: e.target.value } : x,
                          ),
                        )
                      }
                      className="h-8 w-36 text-xs"
                      placeholder="Product Manager"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || rows.some((r) => !r.roleLabel.trim())}
            onClick={() => save.mutate(rows, { onSuccess: onClose })}
          >
            Save approvers
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DecisionDialog({
  projectId,
  release,
  decision,
  onClose,
}: {
  projectId: string;
  release: ReleaseDetail;
  decision: 'APPROVED' | 'REJECTED';
  onClose: () => void;
}) {
  const [comment, setComment] = useState('');
  const decide = useDecide(projectId, release.id);
  const reject = decision === 'REJECTED';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            decide.mutate({ decision, comment }, { onSuccess: onClose });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {reject ? 'Reject' : 'Approve'} {release.name}
            </DialogTitle>
            <DialogDescription>
              Readiness {release.readiness.score}/100 ·{' '}
              {release.gates.filter((g) => g.passed).length} of {release.gates.length} gates met.
              The current numbers are saved with your decision.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-sm font-medium">
            {reject ? 'Why are you rejecting it?' : 'Comment (optional)'}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              required={reject}
              rows={4}
              className="rounded-md border bg-background p-2 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={reject ? 'destructive' : 'default'}
              disabled={decide.isPending || (reject && !comment.trim())}
            >
              {reject ? 'Reject release' : 'Approve release'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
