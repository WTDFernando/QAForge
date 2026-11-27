'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  CalendarClock,
  Link2,
  Loader2,
  Mail,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  REPORT_TYPE_INFO,
  REPORT_TYPES,
  type ExportFormat,
  type ReportType,
} from '@qaforge/shared';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { PageHeader } from '@/components/shell/page-header';
import { useCreateAction } from '@/components/shell/ui-state';
import { useAiAvailability } from '@/components/ai/ai-button';
import { formatDate } from '@/components/releases/parts';
import {
  useCreateReport,
  useDeleteReport,
  useDeleteReportSchedule,
  useReleases,
  useReports,
  useReportSchedules,
  useSaveReportSchedule,
  type ScheduleRow,
} from '@/hooks/releases';
import { useCurrentProject } from '@/hooks/queries';
import { useTestRuns } from '@/hooks/runs';
import { useCan } from '@/hooks/use-permission';
import { cn, timeAgo } from '@/lib/utils';

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export default function ReportsPage() {
  const { project, org } = useCurrentProject();
  const pid = project?.id;
  const canWrite = useCan('report:write');
  const reports = useReports(pid);
  const del = useDeleteReport(pid ?? '');
  const [open, setOpen] = useState(false);
  useCreateAction('New report', canWrite ? () => setOpen(true) : null);
  const base = project && org ? `/${org.slug}/p/${project.key}/reports` : '';
  const all = reports.data ?? [];

  return (
    <div className="pb-10">
      <PageHeader
        breadcrumb={project?.name}
        title="Reports"
        description="Numbers come straight from the database. Export to PDF, Word, Excel or CSV, or share a read-only link."
        actions={
          canWrite && (
            <Button onClick={() => setOpen(true)} disabled={!pid}>
              <Plus /> New report
            </Button>
          )
        }
      />
      <div className="grid gap-6 px-6 lg:px-8">
        <section aria-label="Reports" className="overflow-hidden rounded-xl border bg-card">
          {reports.isError ? (
            <ErrorState error={reports.error} retry={() => reports.refetch()} what="reports" />
          ) : reports.isPending ? (
            <div className="grid gap-2 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : all.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No reports yet"
              description="Create a Go / No-Go for a release, an execution report for a test run, a traceability matrix, or bug, sprint and automation summaries."
              action={
                canWrite && (
                  <Button onClick={() => setOpen(true)}>
                    <Plus /> New report
                  </Button>
                )
              }
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-background text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2">Report</th>
                  <th className="hidden px-4 py-2 md:table-cell">Type</th>
                  <th className="hidden px-4 py-2 lg:table-cell">Created</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {all.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-accent/40">
                    <td className="px-4 py-2.5">
                      <Link href={`${base}/${r.id}`} className="font-medium hover:underline">
                        {r.title}
                      </Link>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {r.schedule && (
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="size-3" aria-hidden /> {r.schedule.name}
                          </span>
                        )}
                        {r.hasNarrative && (
                          <span className="inline-flex items-center gap-1">
                            <Sparkles className="size-3" aria-hidden /> AI summary
                          </span>
                        )}
                        {r.shared && (
                          <span className="inline-flex items-center gap-1">
                            <Link2 className="size-3" aria-hidden /> Shared until{' '}
                            {formatDate(r.shareExpiresAt)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 text-xs md:table-cell">
                      {REPORT_TYPE_INFO[r.type].label}
                    </td>
                    <td className="hidden px-4 py-2.5 text-xs text-muted-foreground lg:table-cell">
                      {timeAgo(r.createdAt)}
                      {r.createdBy && ` by ${r.createdBy}`}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.status === 'QUEUED' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Building
                        </span>
                      ) : r.status === 'FAILED' ? (
                        <span
                          className="rounded-full bg-destructive-subtle px-2 py-0.5 text-xs font-semibold text-destructive-text"
                          title={r.error ?? undefined}
                        >
                          Failed
                        </span>
                      ) : (
                        <span className="rounded-full bg-success-subtle px-2 py-0.5 text-xs font-semibold text-success-text">
                          Ready
                        </span>
                      )}
                    </td>
                    <td className="px-2">
                      {canWrite && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${r.title} actions`}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                confirm(`Delete "${r.title}" and its exports?`) && del.mutate(r.id)
                              }
                            >
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {pid && <SchedulesSection projectId={pid} />}
      </div>
      {pid && open && (
        <NewReportDialog projectId={pid} base={base} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function NewReportDialog({
  projectId,
  base,
  onClose,
}: {
  projectId: string;
  base: string;
  onClose: () => void;
}) {
  const [type, setType] = useState<ReportType>('GO_NO_GO');
  const [releaseId, setReleaseId] = useState('');
  const [runIds, setRunIds] = useState<string[]>([]);
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 14 * DAY)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const ai = useAiAvailability('report');
  const canAi = useCan('ai:use');
  const [narrative, setNarrative] = useState(true);
  const releases = useReleases(projectId);
  const runs = useTestRuns(projectId);
  const create = useCreateReport(projectId);
  const router = useRouter();
  const needs = REPORT_TYPE_INFO[type].needs;
  const valid =
    needs === 'release'
      ? !!releaseId
      : needs === 'runs'
        ? !!releaseId || runIds.length > 0
        : needs === 'period'
          ? from <= to
          : true;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              {
                type,
                narrative: narrative && ai.ok && canAi,
                params:
                  needs === 'period'
                    ? {
                        ...(releaseId ? { releaseId } : {}),
                        from: new Date(`${from}T00:00:00`),
                        to: new Date(`${to}T23:59:59`),
                      }
                    : needs === 'runs' && !releaseId
                      ? { testRunIds: runIds }
                      : releaseId
                        ? { releaseId }
                        : {},
              },
              { onSuccess: (r) => router.push(`${base}/${r.id}`) },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>New report</DialogTitle>
            <DialogDescription>
              The numbers are computed now and frozen in the report.
            </DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="Report type" className="grid gap-2 sm:grid-cols-2">
            {REPORT_TYPES.map((t) => (
              <button
                type="button"
                key={t}
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className={cn(
                  'rounded-lg border p-3 text-left',
                  type === t ? 'border-primary bg-primary-subtle' : 'hover:bg-accent',
                )}
              >
                <span className="block text-sm font-semibold">{REPORT_TYPE_INFO[t].label}</span>
                <span className="block text-xs text-muted-foreground">
                  {REPORT_TYPE_INFO[t].description}
                </span>
              </button>
            ))}
          </div>
          {needs !== 'period' || type === 'BUG_SUMMARY' ? (
            <label className="grid gap-1 text-sm font-medium">
              Release{needs === 'release' ? '' : ' (optional)'}
              <select
                value={releaseId}
                onChange={(e) => setReleaseId(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
              >
                <option value="">{needs === 'release' ? 'Choose a release' : 'None'}</option>
                {releases.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.ref} {r.name} ({r.version})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {needs === 'runs' && !releaseId && (
            <fieldset className="grid gap-1">
              <legend className="mb-1 text-sm font-medium">Test runs</legend>
              <ul className="max-h-48 overflow-auto rounded-lg border">
                {runs.data?.items.map((r) => (
                  <li key={r.id}>
                    <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent">
                      <Checkbox
                        checked={runIds.includes(r.id)}
                        onCheckedChange={(v) =>
                          setRunIds((x) => (v ? [...x, r.id] : x.filter((id) => id !== r.id)))
                        }
                      />
                      <span className="font-mono text-xs text-muted-foreground">{r.ref}</span>
                      {r.name}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {needs === 'period' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm font-medium">
                From
                <Input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                To
                <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          )}
          {canAi && (
            <label
              className={cn(
                'flex items-start gap-2 rounded-lg border p-3 text-sm',
                !ai.ok && 'opacity-60',
              )}
            >
              <Checkbox
                checked={narrative && ai.ok}
                disabled={!ai.ok}
                onCheckedChange={(v) => setNarrative(v === true)}
                className="mt-0.5"
              />
              <span>
                <span className="flex items-center gap-1.5 font-medium">
                  <Sparkles className="size-3.5 text-primary" aria-hidden /> Add an AI summary
                </span>
                <span className="block text-xs text-muted-foreground">
                  {ai.ok
                    ? 'The Report Agent writes a summary, risks and a recommendation using only the numbers in the report.'
                    : ai.reason}
                </span>
              </span>
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              Create report
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PRESETS: [string, string][] = [
  ['0 8 * * 1', 'Mondays at 08:00'],
  ['0 8 * * 1-5', 'Weekdays at 08:00'],
  ['0 17 * * 5', 'Fridays at 17:00'],
  ['0 8 1 * *', 'First of the month'],
];

function SchedulesSection({ projectId }: { projectId: string }) {
  const canSchedule = useCan('report:schedule');
  const schedules = useReportSchedules(projectId);
  const save = useSaveReportSchedule(projectId);
  const del = useDeleteReportSchedule(projectId);
  const [editing, setEditing] = useState<ScheduleRow | 'new' | null>(null);
  return (
    <section aria-labelledby="schedules-h" className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="flex-1">
          <h2 id="schedules-h" className="text-sm font-semibold">
            Emailed reports
          </h2>
          <p className="text-xs text-muted-foreground">
            Send a report to people on a schedule, e.g. a weekly bug summary for the product owner.
          </p>
        </div>
        {canSchedule && (
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus /> Schedule
          </Button>
        )}
      </div>
      {schedules.isError ? (
        <ErrorState error={schedules.error} retry={() => schedules.refetch()} what="schedules" />
      ) : schedules.isPending ? (
        <Skeleton className="m-4 h-10" />
      ) : !schedules.data?.length ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No scheduled reports.</p>
      ) : (
        <ul className="divide-y">
          {schedules.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Mail className="size-4 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {s.name}
                  {!s.enabled && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      Paused
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {REPORT_TYPE_INFO[s.type].label} ·{' '}
                  {PRESETS.find(([c]) => c === s.cron)?.[1] ?? s.cron} {s.timezone} · to{' '}
                  {s.recipients.join(', ')} · {s.formats.join(', ').toUpperCase()}
                </div>
              </div>
              <span className="text-xs text-muted-foreground">
                Next: {s.enabled && s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '—'}
              </span>
              {canSchedule && (
                <span className="flex gap-1">
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
                    onClick={() => confirm(`Delete "${s.name}"?`) && del.mutate(s.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ScheduleDialog
          projectId={projectId}
          schedule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
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
  const releases = useReleases(projectId);
  const save = useSaveReportSchedule(projectId);
  const [name, setName] = useState(schedule?.name ?? 'Weekly bug summary');
  const [type, setType] = useState<ReportType>(schedule?.type ?? 'BUG_SUMMARY');
  const [cron, setCron] = useState(schedule?.cron ?? '0 8 * * 1');
  const [timezone, setTimezone] = useState(
    schedule?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
  );
  const [releaseId, setReleaseId] = useState(schedule?.params.releaseId ?? '');
  const [recipients, setRecipients] = useState(schedule?.recipients.join(', ') ?? '');
  const [formats, setFormats] = useState<ExportFormat[]>(schedule?.formats ?? ['pdf']);
  const needsRelease = type === 'GO_NO_GO' || type === 'TEST_EXECUTION';
  const list = recipients
    .split(/[,\s;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const badEmail = list.find((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(
              {
                id: schedule?.id,
                name,
                type,
                cron,
                timezone,
                params: releaseId ? { releaseId } : {},
                recipients: list,
                formats,
              },
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
            <DialogTitle>
              {schedule ? 'Edit emailed report' : 'Email a report on a schedule'}
            </DialogTitle>
            <DialogDescription>
              Period reports cover the time since the previous email.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-sm font-medium">
            Name
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Report
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ReportType)}
              className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
            >
              {REPORT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {REPORT_TYPE_INFO[t].label}
                </option>
              ))}
            </select>
          </label>
          {(needsRelease || type === 'BUG_SUMMARY' || type === 'TRACEABILITY_MATRIX') && (
            <label className="grid gap-1 text-sm font-medium">
              Release{needsRelease ? '' : ' (optional)'}
              <select
                value={releaseId}
                onChange={(e) => setReleaseId(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
              >
                <option value="">{needsRelease ? 'Choose a release' : 'None'}</option>
                {releases.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.ref} {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">When</span>
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
                aria-label="Cron expression"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                className="font-mono"
              />
              <Input
                aria-label="Time zone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </div>
          </div>
          <label className="grid gap-1 text-sm font-medium">
            Send to
            <Input
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="pm@example.com, lead@example.com"
              aria-invalid={!!badEmail}
              aria-describedby="rcpt-help"
            />
            <span
              id="rcpt-help"
              className={cn(
                'text-xs font-normal',
                badEmail ? 'text-destructive-text' : 'text-muted-foreground',
              )}
            >
              {badEmail
                ? `"${badEmail}" isn't an email address`
                : 'Recipients get the files, not access to QAForge.'}
            </span>
          </label>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-1 text-sm font-medium">Attach</legend>
            {(['pdf', 'docx', 'xlsx', 'csv'] as const).map((f) => (
              <label key={f} className="flex items-center gap-1.5">
                <Checkbox
                  checked={formats.includes(f)}
                  onCheckedChange={(v) =>
                    setFormats((x) => (v ? [...x, f] : x.filter((y) => y !== f)))
                  }
                />
                {f.toUpperCase()}
              </label>
            ))}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !name.trim() ||
                !list.length ||
                !!badEmail ||
                !formats.length ||
                (needsRelease && !releaseId) ||
                save.isPending
              }
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
