'use client';
import { useState, useSyncExternalStore } from 'react';
import { CalendarClock, Copy, KeyRound, Lock, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cronSchema, type AutomationSelection } from '@qaforge/shared';
import { Button } from '@/components/ui/button';
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
import { EmptyState, ErrorState } from '@/components/ui/states';
import { AutomationHeader } from '@/components/automation/shell';
import {
  SelectionPicker,
  describeSelection,
  selectionValid,
} from '@/components/automation/selection';
import {
  useCreateToken,
  useDeleteSchedule,
  useRevokeToken,
  useSaveSchedule,
  useSchedules,
  useTokens,
  type ScheduleRow,
} from '@/hooks/automation';
import { useEnvironments } from '@/hooks/qa';
import { useCurrentProject } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';
import { cn, timeAgo } from '@/lib/utils';

const PRESETS: [string, string][] = [
  ['0 * * * *', 'Every hour'],
  ['0 6 * * *', 'Every day at 06:00'],
  ['0 6 * * 1-5', 'Weekdays at 06:00'],
  ['*/15 * * * *', 'Every 15 minutes'],
];

function describeCron(cron: string) {
  return PRESETS.find(([c]) => c === cron)?.[1] ?? cron;
}

const subscribe = () => () => {};
/** The browser's origin (the web app proxies /v1 to the API), without a hydration mismatch. */
function useOrigin() {
  return useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => 'https://qaforge.example.com',
  );
}

export default function SchedulesCiPage() {
  const { project } = useCurrentProject();
  const pid = project?.id;
  const canConfigure = useCan('automation:configure');
  const schedules = useSchedules(pid);
  const [editing, setEditing] = useState<ScheduleRow | 'new' | null>(null);
  const save = useSaveSchedule(pid ?? '');
  const del = useDeleteSchedule(pid ?? '');

  return (
    <div className="pb-10">
      <AutomationHeader />
      <div className="grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-6 p-6 lg:px-8">
        <section
          aria-labelledby="schedules-h"
          className="overflow-hidden rounded-xl border bg-card"
        >
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <div className="flex-1">
              <h2 id="schedules-h" className="text-sm font-semibold">
                Schedules
              </h2>
              <p className="text-xs text-muted-foreground">
                Run tests on a timetable, e.g. a nightly regression against staging.
              </p>
            </div>
            {canConfigure && (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus /> New schedule
              </Button>
            )}
          </div>
          {schedules.isError ? (
            <ErrorState
              error={schedules.error}
              retry={() => schedules.refetch()}
              what="schedules"
            />
          ) : schedules.isPending ? (
            <div className="grid gap-2 p-4">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : !schedules.data?.length ? (
            <EmptyState
              icon={CalendarClock}
              title="No schedules"
              description="Add one to run your suite automatically, every night or every hour."
            />
          ) : (
            <ul className="divide-y">
              {schedules.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      {!s.enabled && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                          Paused
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {describeCron(s.cron)}{' '}
                      <code className="ml-1 rounded bg-muted px-1">{s.cron}</code> {s.timezone} ·{' '}
                      {describeSelection(s.selection)}
                      {s.environment && ` · ${s.environment.name}`}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>
                      Next:{' '}
                      {s.enabled && s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '—'}
                    </div>
                    <div>Last: {s.lastRunAt ? timeAgo(s.lastRunAt) : 'never'}</div>
                  </div>
                  {canConfigure && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => save.mutate({ id: s.id, enabled: !s.enabled })}
                      >
                        {s.enabled ? 'Pause' : 'Resume'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete ${s.name}`}
                        onClick={() => confirm(`Delete schedule "${s.name}"?`) && del.mutate(s.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <CiSection projectId={pid} canConfigure={canConfigure} />
      </div>
      {pid && editing && (
        <ScheduleDialog
          projectId={pid}
          schedule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ScheduleDialog({
  projectId,
  schedule,
  onClose,
}: {
  projectId: string;
  schedule: ScheduleRow | null;
  onClose: () => void;
}) {
  const envs = useEnvironments(projectId);
  const [name, setName] = useState(schedule?.name ?? 'Nightly regression');
  const [cron, setCron] = useState(schedule?.cron ?? '0 6 * * 1-5');
  const [timezone, setTimezone] = useState(
    schedule?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
  );
  const [selection, setSelection] = useState<AutomationSelection>(
    schedule?.selection ?? { kind: 'all' },
  );
  const [envId, setEnvId] = useState(schedule?.environment?.id ?? '');
  const save = useSaveSchedule(projectId);
  const cronError = cronSchema.safeParse(cron).error?.issues[0]?.message;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(
              { id: schedule?.id, name, cron, timezone, selection, environmentId: envId || null },
              {
                onSuccess: () => {
                  toast.success('Schedule saved');
                  onClose();
                },
                onError: (err) => toast.error(err.message),
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>{schedule ? 'Edit schedule' : 'New schedule'}</DialogTitle>
            <DialogDescription>Times use the time zone you choose.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-sm font-medium">
            Name
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <div className="grid gap-1.5">
            <label htmlFor="cron" className="text-sm font-medium">
              When
            </label>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Presets">
              {PRESETS.map(([c, l]) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setCron(c)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs',
                    cron === c
                      ? 'border-primary bg-primary-subtle text-primary'
                      : 'hover:bg-accent',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-[1fr_12rem] gap-2">
              <Input
                id="cron"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                className="font-mono"
                aria-invalid={!!cronError}
                aria-describedby="cron-help"
              />
              <Input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                aria-label="Time zone"
              />
            </div>
            <span
              id="cron-help"
              className={cn(
                'text-xs',
                cronError ? 'text-destructive-text' : 'text-muted-foreground',
              )}
            >
              {cronError ?? 'minute hour day-of-month month day-of-week'}
            </span>
          </div>
          <SelectionPicker projectId={projectId} value={selection} onChange={setSelection} />
          <label className="grid gap-1 text-sm font-medium">
            Environment
            <select
              value={envId}
              onChange={(e) => setEnvId(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">None</option>
              {envs.data?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || !!cronError || !selectionValid(selection) || save.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="relative min-w-0">
      <pre
        aria-label={label}
        className="overflow-x-auto rounded-lg border bg-muted/50 p-3 pr-12 font-mono text-[12px] leading-5"
      >
        {text}
      </pre>
      <Button
        size="icon-sm"
        variant="ghost"
        className="absolute top-1.5 right-1.5"
        aria-label={`Copy ${label}`}
        onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success('Copied'))}
      >
        <Copy className="size-4" />
      </Button>
    </div>
  );
}

function CiSection({ projectId, canConfigure }: { projectId?: string; canConfigure: boolean }) {
  const tokens = useTokens(projectId, canConfigure);
  const create = useCreateToken(projectId ?? '');
  const revoke = useRevokeToken(projectId ?? '');
  const [name, setName] = useState('GitHub Actions');
  const [created, setCreated] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<'curl' | 'github'>('github');
  const origin = useOrigin();
  const hook = `${origin}/v1/hooks/automation`;
  const curl = `# Start a run (the Idempotency-Key makes retries safe)
RUN=$(curl -fsS -X POST ${hook} \\
  -H "Authorization: Bearer $QAFORGE_TOKEN" \\
  -H "Idempotency-Key: $CI_PIPELINE_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"environment":"Staging","build":"'$GIT_SHA'","selection":{"kind":"tags","tags":["smoke"]}}')
REF=$(echo "$RUN" | jq -r .ref)

# Wait for the result; fail the pipeline unless it passed
until [ "$(curl -fsS -H "Authorization: Bearer $QAFORGE_TOKEN" ${hook}/runs/$REF | jq -r .done)" = true ]; do sleep 10; done
curl -fsS -H "Authorization: Bearer $QAFORGE_TOKEN" ${hook}/runs/$REF | jq -e '.status == "PASSED"'`;
  const github = `# .github/workflows/qaforge.yml
name: QAForge tests
on: [deployment_status]
jobs:
  qaforge:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - name: Run QAForge automation
        env:
          QAFORGE_TOKEN: \${{ secrets.QAFORGE_TOKEN }}
        run: |
          RUN=$(curl -fsS -X POST ${hook} \\
            -H "Authorization: Bearer $QAFORGE_TOKEN" \\
            -H "Idempotency-Key: \${{ github.run_id }}-\${{ github.run_attempt }}" \\
            -H "Content-Type: application/json" \\
            -d '{"environment":"Staging","build":"\${{ github.sha }}","ref":"\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}"}')
          REF=$(echo "$RUN" | jq -r .ref); echo "QAForge run: $(echo "$RUN" | jq -r .url)"
          for i in $(seq 1 90); do
            S=$(curl -fsS -H "Authorization: Bearer $QAFORGE_TOKEN" ${hook}/runs/$REF)
            [ "$(echo "$S" | jq -r .done)" = true ] && break; sleep 10
          done
          echo "$S" | jq -e '.status == "PASSED"'`;

  return (
    <section aria-labelledby="ci-h" className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h2 id="ci-h" className="text-sm font-semibold">
          CI pipelines
        </h2>
        <p className="text-xs text-muted-foreground">
          Trigger runs after a deploy and gate the pipeline on the result. Tokens can only start and
          read automation runs in this project.
        </p>
      </div>
      {!canConfigure ? (
        <EmptyState
          icon={Lock}
          title="QA Leads and Admins manage CI tokens"
          description="Ask one of them for a token for your pipeline."
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4">
          {created && (
            <div
              role="status"
              className="grid gap-2 rounded-lg border border-success/40 bg-success-subtle/50 p-3"
            >
              <p className="text-sm font-medium">Copy this token now. It won’t be shown again.</p>
              <CopyBlock label="New token" text={created} />
              <p className="text-xs text-muted-foreground">
                Store it as a secret in your CI (e.g. QAFORGE_TOKEN), never in the repository.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-fit"
                onClick={() => setCreated(null)}
              >
                I’ve stored it
              </Button>
            </div>
          )}
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(
                { name, expiresInDays: 365 },
                { onSuccess: (t) => setCreated(t.token) },
              );
            }}
          >
            <label className="grid flex-1 gap-1 text-sm font-medium">
              Token name
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
              />
            </label>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              <KeyRound /> Create token
            </Button>
          </form>
          {tokens.isError ? (
            <ErrorState error={tokens.error} retry={() => tokens.refetch()} what="tokens" />
          ) : tokens.isPending ? (
            <Skeleton className="h-10" />
          ) : tokens.data && tokens.data.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="py-1.5">Name</th>
                  <th>Token</th>
                  <th className="hidden md:table-cell">Last used</th>
                  <th className="hidden md:table-cell">Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tokens.data.map((t) => (
                  <tr key={t.id} className={cn('border-t', t.revokedAt && 'text-muted-foreground')}>
                    <td className="py-2">{t.name}</td>
                    <td className="font-mono text-xs">{t.prefix}…</td>
                    <td className="hidden text-xs md:table-cell">
                      {t.lastUsedAt ? timeAgo(t.lastUsedAt) : 'never'}
                    </td>
                    <td className="hidden text-xs md:table-cell">
                      {t.revokedAt
                        ? 'Revoked'
                        : t.expiresAt
                          ? new Date(t.expiresAt).toLocaleDateString()
                          : 'Never'}
                    </td>
                    <td className="text-right">
                      {!t.revokedAt && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive-text"
                          onClick={() =>
                            confirm(`Revoke "${t.name}"? Pipelines using it will stop working.`) &&
                            revoke.mutate(t.id)
                          }
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No tokens yet.</p>
          )}
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
            <div role="tablist" aria-label="Snippet" className="flex gap-1">
              {(['github', 'curl'] as const).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={snippet === k}
                  onClick={() => setSnippet(k)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium',
                    snippet === k ? 'bg-accent' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {k === 'github' ? 'GitHub Actions' : 'Any CI (curl)'}
                </button>
              ))}
            </div>
            <CopyBlock
              label={snippet === 'github' ? 'GitHub Actions workflow' : 'curl script'}
              text={snippet === 'github' ? github : curl}
            />
          </div>
        </div>
      )}
    </section>
  );
}
