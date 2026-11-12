'use client';
import { useState } from 'react';
import { ExternalLink, FileText, Link2, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { UploadZone } from '@/components/requirements/upload-zone';
import { useCurrentProject } from '@/hooks/queries';
import { useAddLinkSource, useDeleteSource, useRequirements, useSources } from '@/hooks/qa';
import { useCan } from '@/hooks/use-permission';
import { timeAgo } from '@/lib/utils';

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function RequirementsIndexPage() {
  const { project } = useCurrentProject();
  const sources = useSources(project?.id);
  const reqs = useRequirements(project?.id);
  const canEdit = useCan('requirement:write');
  const addLink = useAddLinkSource(project?.id ?? '');
  const del = useDeleteSource(project?.id ?? '');
  const [url, setUrl] = useState('');

  if (!project) return null;
  const empty = reqs.data?.length === 0 && sources.data?.length === 0;

  const submitLink = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parsed = new URL(url);
      await addLink.mutateAsync({
        url: parsed.toString(),
        name: parsed.hostname.includes('figma')
          ? `Figma: ${parsed.pathname.split('/').pop() || 'design'}`
          : parsed.hostname + parsed.pathname,
      });
      setUrl('');
      toast.success('Link added');
    } catch (err) {
      toast.error(
        err instanceof TypeError
          ? 'Enter a full URL, e.g. https://www.figma.com/file/…'
          : err instanceof Error
            ? err.message
            : 'Could not add link',
      );
    }
  };

  return (
    <div id="upload" className="grid gap-6 p-6">
      {empty && (
        <div className="text-center">
          <h2 className="font-semibold">Start with your requirements</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Upload a requirement document to keep it with the project. AI will split it into
            requirements and draft test cases from it (Phase 3). Or press{' '}
            <kbd className="rounded border px-1 text-xs">C</kbd> to write one yourself.
          </p>
        </div>
      )}
      {canEdit && <UploadZone projectId={project.id} />}
      {canEdit && (
        <form onSubmit={submitLink} className="flex gap-2">
          <div className="relative flex-1">
            <Link2 className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Or paste a link (Figma, Confluence, Google Doc…)"
              className="pl-8"
              aria-label="Requirement link"
            />
          </div>
          <Button type="submit" variant="outline" disabled={!url || addLink.isPending}>
            {addLink.isPending && <Loader2 className="animate-spin" />} Add link
          </Button>
        </form>
      )}
      <section aria-labelledby="sources-h">
        <h2 id="sources-h" className="mb-2 text-sm font-medium">
          Sources
        </h2>
        {sources.isLoading ? (
          <Skeleton className="h-20" />
        ) : !sources.data?.length ? (
          <p className="text-sm text-muted-foreground">No documents or links yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {sources.data.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                {s.kind === 'FILE' ? (
                  <FileText className="size-4 text-muted-foreground" />
                ) : (
                  <Link2 className="size-4 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  {s.attachment ? (
                    <a
                      className="truncate font-medium hover:underline"
                      href={`/v1/projects/${project.id}/attachments/${s.attachment.id}/download`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.name}
                    </a>
                  ) : (
                    <a
                      className="inline-flex items-center gap-1 truncate font-medium hover:underline"
                      href={s.url ?? '#'}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {s.name} <ExternalLink className="size-3" />
                    </a>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {s.attachment ? formatSize(s.attachment.size) + ' · ' : ''}added{' '}
                    {timeAgo(s.createdAt)}
                    {s._count.requirements > 0 && ` · ${s._count.requirements} requirements`}
                  </div>
                </div>
                <Badge variant="secondary">
                  {s.status === 'UPLOADED' ? 'Not analyzed' : s.status.toLowerCase()}
                </Badge>
                <Tooltip content="AI analysis arrives with the Requirement Agent (Phase 3)">
                  <span>
                    <Button size="sm" variant="outline" disabled>
                      <Sparkles /> Analyze
                    </Button>
                  </span>
                </Tooltip>
                {canEdit && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${s.name}`}
                    onClick={() =>
                      del.mutate(s.id, { onSuccess: () => toast.success('Source removed') })
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
