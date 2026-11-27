'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Rocket } from 'lucide-react';
import { releaseSchema } from '@qaforge/shared';
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
import { PageHeader } from '@/components/shell/page-header';
import { useCreateAction } from '@/components/shell/ui-state';
import { BAND, formatDate, ReadinessBadge, ReleaseStatusBadge } from '@/components/releases/parts';
import { useCreateRelease, useReleases, type ReleaseRow } from '@/hooks/releases';
import { useCurrentProject } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';

export default function ReleasesPage() {
  const { project, org } = useCurrentProject();
  const canWrite = useCan('release:write');
  const releases = useReleases(project?.id);
  const [open, setOpen] = useState(false);
  useCreateAction('New release', canWrite ? () => setOpen(true) : null);
  const base = project && org ? `/${org.slug}/p/${project.key}/releases` : '';
  const all = releases.data ?? [];
  const active = all.filter((r) => r.status !== 'RELEASED');
  const shipped = all.filter((r) => r.status === 'RELEASED');

  return (
    <div className="pb-10">
      <PageHeader
        breadcrumb={project?.name}
        title="Releases"
        description="Group what ships, check it against quality gates, and get it signed off."
        actions={
          canWrite && (
            <Button onClick={() => setOpen(true)} disabled={!project}>
              <Plus /> New release
            </Button>
          )
        }
      />
      <div className="grid gap-6 px-6 lg:px-8">
        {releases.isError ? (
          <ErrorState error={releases.error} retry={() => releases.refetch()} what="releases" />
        ) : releases.isPending ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        ) : all.length === 0 ? (
          <EmptyState
            icon={Rocket}
            title="No releases yet"
            description="A release collects requirements, test runs and bugs, measures them against quality gates and records who signed off."
            action={
              canWrite && (
                <Button onClick={() => setOpen(true)}>
                  <Plus /> New release
                </Button>
              )
            }
          />
        ) : (
          <>
            <section aria-labelledby="active-h">
              <h2 id="active-h" className="mb-3 text-sm font-semibold text-muted-foreground">
                In progress ({active.length})
              </h2>
              {active.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing in progress.</p>
              ) : (
                <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {active.map((r) => (
                    <ReleaseCard key={r.id} r={r} href={`${base}/${r.ref}`} />
                  ))}
                </ul>
              )}
            </section>
            {shipped.length > 0 && (
              <section aria-labelledby="shipped-h">
                <h2 id="shipped-h" className="mb-3 text-sm font-semibold text-muted-foreground">
                  Released ({shipped.length})
                </h2>
                <ul className="overflow-hidden rounded-xl border bg-card">
                  {shipped.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center gap-3 border-b px-4 py-2.5 text-sm last:border-b-0"
                    >
                      <span className="font-mono text-xs text-muted-foreground">{r.ref}</span>
                      <Link href={`${base}/${r.ref}`} className="font-medium hover:underline">
                        {r.name} <span className="text-muted-foreground">{r.version}</span>
                      </Link>
                      <span className="ml-auto text-xs text-muted-foreground">
                        Released {formatDate(r.releasedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
      {project && open && (
        <NewReleaseDialog projectId={project.id} base={base} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function ReleaseCard({ r, href }: { r: ReleaseRow; href: string }) {
  const approved = r.approvals.filter((a) => a.status === 'APPROVED').length;
  const score = r.readiness?.score ?? 0;
  return (
    <li className="relative rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm focus-within:ring-2 focus-within:ring-ring">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-muted-foreground">{r.ref}</div>
          <Link
            href={href}
            className="block truncate font-semibold after:absolute after:inset-0 focus:outline-none"
          >
            {r.name} <span className="font-normal text-muted-foreground">{r.version}</span>
          </Link>
        </div>
        <ReleaseStatusBadge status={r.status} />
      </div>
      <div className="mt-3 flex items-end gap-2">
        <span
          className={cn(
            'text-3xl font-bold tabular-nums',
            r.readiness && BAND[r.readiness.band].text,
          )}
        >
          {r.readiness ? score : '—'}
        </span>
        <span className="pb-1 text-xs text-muted-foreground">/100 readiness</span>
        {r.readiness && (
          <span className="ml-auto pb-1">
            <ReadinessBadge band={r.readiness.band} blockingFailed={r.readiness.blockingFailed} />
          </span>
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className={cn('h-full rounded-full', r.readiness ? BAND[r.readiness.band].bar : '')}
          style={{ width: `${score}%` }}
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Target {formatDate(r.targetDate)} · {r.gatesPassed ?? 0}/{r.gatesTotal ?? 0} gates met ·{' '}
        {r._count.testRuns} run
        {r._count.testRuns === 1 ? '' : 's'}
        {r.approvals.length > 0 && ` · ${approved}/${r.approvals.length} signed off`}
      </p>
    </li>
  );
}

function NewReleaseDialog({
  projectId,
  base,
  onClose,
}: {
  projectId: string;
  base: string;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const create = useCreateRelease(projectId);
  const router = useRouter();
  const parsed = releaseSchema.safeParse({ name, version, targetDate: targetDate || null });
  const versionError = version
    ? parsed.error?.issues.find((i) => i.path[0] === 'version')?.message
    : undefined;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!parsed.success) return;
            create.mutate(parsed.data, { onSuccess: (r) => router.push(`${base}/${r.ref}`) });
          }}
        >
          <DialogHeader>
            <DialogTitle>New release</DialogTitle>
            <DialogDescription>
              It starts with sensible quality gates; you can change them on the release.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-sm font-medium">
            Name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Spring release"
              required
              autoFocus
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm font-medium">
              Version
              <Input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="2.4.0"
                className="font-mono"
                required
                aria-invalid={!!versionError}
                aria-describedby="version-error"
              />
              {versionError && (
                <span id="version-error" className="text-xs font-normal text-destructive-text">
                  {versionError}
                </span>
              )}
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Target date
              <Input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!parsed.success || create.isPending}>
              Create release
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
