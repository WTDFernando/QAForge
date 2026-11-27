'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, Copy, Download, Link2, Loader2, Sparkles } from 'lucide-react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Topbar } from '@/components/shell/topbar';
import { useAiAvailability } from '@/components/ai/ai-button';
import { formatDate } from '@/components/releases/parts';
import { ReportDocView } from '@/components/reports/report-doc-view';
import { useStartAgentJob } from '@/hooks/ai';
import { useReport, useShareReport, useUnshareReport, type ReportDetail } from '@/hooks/releases';
import { useCurrentProject } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';

const FORMAT_LABEL = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', csv: 'CSV' } as const;

export default function ReportPage() {
  const { id, org: orgSlug, key } = useParams<{ id: string; org: string; key: string }>();
  const { project } = useCurrentProject();
  const pid = project?.id;
  const report = useReport(pid, id);
  const r = report.data;
  // From the URL, so server and client render the same links.
  const base = `/${orgSlug}/p/${key}`;
  return (
    <div className="pb-10">
      <Topbar>
        <div className="truncate text-sm text-muted-foreground">
          <Link href={`${base}/reports`} className="hover:underline">
            Reports
          </Link>{' '}
          <span aria-hidden>›</span>{' '}
          <span className="font-medium text-foreground">{r?.title ?? '…'}</span>
        </div>
      </Topbar>
      {report.isError ? (
        <ErrorState error={report.error} retry={() => report.refetch()} what="this report" />
      ) : !r || !pid ? (
        <div className="grid gap-4 p-6 lg:px-8">
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <ReportView projectId={pid} r={r} base={base} />
      )}
    </div>
  );
}

function ReportView({ projectId, r, base }: { projectId: string; r: ReportDetail; base: string }) {
  const canShare = useCan('report:share');
  const canWrite = useCan('report:write');
  const canAi = useCan('ai:use');
  const ai = useAiAvailability('report');
  const start = useStartAgentJob(projectId);
  const [shareOpen, setShareOpen] = useState(false);
  const narrating = r.narrativeJob && ['QUEUED', 'RUNNING'].includes(r.narrativeJob.status);

  const summarySlot = narrating ? (
    <div
      role="status"
      className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {r.narrativeJob?.progressMessage ?? 'The Report Agent is writing a summary…'}
    </div>
  ) : canWrite && canAi ? (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-4">
      <Sparkles className="size-4 text-primary" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        {r.narrativeJob?.status === 'FAILED'
          ? `The summary couldn’t be written: ${r.narrativeJob.error ?? 'unknown error'}`
          : ai.ok
            ? 'Add a short summary, risks and a recommendation written from these numbers.'
            : ai.reason}
      </p>
      {ai.ok && (
        <Button
          size="sm"
          variant="outline"
          disabled={start.isPending}
          onClick={() => start.mutate({ kind: 'write-report', reportId: r.id })}
        >
          <Sparkles /> Write summary
        </Button>
      )}
    </div>
  ) : null;

  return (
    <div className="grid gap-5 px-6 pt-6 lg:px-8">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight">{r.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {r.data?.subtitle ?? ''}
            {r.data && ' · '}generated{' '}
            {new Date(r.data?.generatedAt ?? r.createdAt).toLocaleString()}
            {r.schedule && ` · from “${r.schedule.name}”`}
            {r.release && !r.data?.subtitle.includes(r.release.ref) && (
              <>
                {' · '}
                <Link
                  href={`${base}/releases/${r.release.ref}`}
                  className="underline-offset-2 hover:underline"
                >
                  {r.release.ref}
                </Link>
              </>
            )}
          </p>
        </div>
        {r.status === 'READY' && (
          <div className="flex flex-wrap items-center gap-2">
            {r.exports.length ? (
              <div
                role="group"
                aria-label="Download"
                className="flex overflow-hidden rounded-md border bg-card"
              >
                {r.exports.map((e, i) => (
                  <a
                    key={e.id}
                    href={`/v1/projects/${projectId}/attachments/${e.id}/download`}
                    download={e.fileName}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium hover:bg-accent ${i ? 'border-l' : ''}`}
                  >
                    {i === 0 && <Download className="size-4" aria-hidden />}
                    {FORMAT_LABEL[e.format]}
                  </a>
                ))}
              </div>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Preparing downloads
              </span>
            )}
            {canShare && (
              <Button onClick={() => setShareOpen(true)}>
                <Link2 /> {r.shared ? 'Shared' : 'Share link'}
              </Button>
            )}
          </div>
        )}
      </div>
      {r.shared && (
        <p className="-mt-2 text-xs text-muted-foreground">
          A read-only link is active until {formatDate(r.shareExpiresAt)}.
        </p>
      )}
      {r.status === 'QUEUED' ? (
        <div role="status" className="grid gap-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Building the report from the
            database…
          </p>
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : r.status === 'FAILED' || !r.data ? (
        <EmptyState
          icon={AlertTriangle}
          title="This report couldn’t be built"
          description={r.error ?? 'Try creating it again.'}
        />
      ) : (
        <ReportDocView doc={r.data} narrative={r.narrative} summarySlot={summarySlot} />
      )}
      {shareOpen && <ShareDialog projectId={projectId} r={r} onClose={() => setShareOpen(false)} />}
    </div>
  );
}

function ShareDialog({
  projectId,
  r,
  onClose,
}: {
  projectId: string;
  r: ReportDetail;
  onClose: () => void;
}) {
  const [days, setDays] = useState(14);
  const [url, setUrl] = useState<string | null>(null);
  const share = useShareReport(projectId, r.id);
  const unshare = useUnshareReport(projectId, r.id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share a read-only link</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this report and download its files, without signing in.
            They can’t see anything else in QAForge.
          </DialogDescription>
        </DialogHeader>
        {url ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium">Copy the link now. It won’t be shown again.</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={url}
                aria-label="Share link"
                className="h-9 min-w-0 flex-1 rounded-md border bg-muted px-2 font-mono text-xs"
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="outline"
                aria-label="Copy link"
                onClick={() =>
                  void navigator.clipboard.writeText(url).then(() => toast.success('Link copied'))
                }
              >
                <Copy />
              </Button>
            </div>
          </div>
        ) : (
          <label className="grid gap-1 text-sm font-medium">
            Link expires after
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
            >
              {[1, 7, 14, 30, 90].map((d) => (
                <option key={d} value={d}>
                  {d} day{d === 1 ? '' : 's'}
                </option>
              ))}
            </select>
            {r.shared && (
              <span className="text-xs font-normal text-muted-foreground">
                A new link replaces the current one.
              </span>
            )}
          </label>
        )}
        <DialogFooter>
          {r.shared && !url && (
            <Button
              variant="outline"
              className="mr-auto text-destructive-text"
              onClick={() => unshare.mutate(undefined, { onSuccess: onClose })}
            >
              Turn off link
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {url ? 'Done' : 'Cancel'}
          </Button>
          {!url && (
            <Button
              disabled={share.isPending}
              onClick={() =>
                share.mutate(days, {
                  onSuccess: (s) => setUrl(`${window.location.origin}${s.path}`),
                })
              }
            >
              Create link
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
