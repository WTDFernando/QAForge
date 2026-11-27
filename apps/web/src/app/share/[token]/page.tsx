'use client';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download } from 'lucide-react';
import type { ExportFormat, ReportDoc, ReportNarrative } from '@qaforge/shared';
import { Logo } from '@/components/logo';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/states';
import { ReportDocView } from '@/components/reports/report-doc-view';
import { api } from '@/lib/api';

const FORMAT_LABEL = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', csv: 'CSV' } as const;

interface SharedReport {
  title: string;
  data: ReportDoc;
  narrative: ReportNarrative | null;
  createdAt: string;
  expiresAt: string | null;
  exports: ExportFormat[];
}

/** Read-only report for people without a QAForge account. The token in the URL is the only grant. */
export default function SharedReportPage() {
  const { token } = useParams<{ token: string }>();
  const q = useQuery({
    queryKey: ['shared-report', token],
    queryFn: () => api.get<SharedReport>(`/v1/share/reports/${encodeURIComponent(token)}`),
    retry: false,
  });
  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center gap-3 border-b bg-card px-6 py-3">
        <Logo />
        <span className="ml-auto text-xs text-muted-foreground">Read-only shared report</span>
      </header>
      <main className="mx-auto grid max-w-6xl gap-5 px-6 py-6">
        {q.isPending ? (
          <>
            <Skeleton className="h-10 w-96" />
            <Skeleton className="h-24" />
            <Skeleton className="h-64" />
          </>
        ) : q.isError || !q.data ? (
          <EmptyState
            icon={AlertTriangle}
            title="This link doesn’t work any more"
            description="It may have expired or been turned off. Ask the person who shared it for a new link."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground">{q.data.data.project.name}</p>
                <h1 className="text-xl font-bold tracking-tight">{q.data.title}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {q.data.data.subtitle} · generated{' '}
                  {new Date(q.data.data.generatedAt).toLocaleString()}
                  {q.data.expiresAt &&
                    ` · link valid until ${new Date(q.data.expiresAt).toLocaleDateString()}`}
                </p>
              </div>
              {q.data.exports.length > 0 && (
                <div
                  role="group"
                  aria-label="Download"
                  className="flex overflow-hidden rounded-md border bg-card"
                >
                  {q.data.exports.map((f, i) => (
                    <a
                      key={f}
                      href={`/v1/share/reports/${encodeURIComponent(token)}/files/${f}`}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium hover:bg-accent ${i ? 'border-l' : ''}`}
                    >
                      {i === 0 && <Download className="size-4" aria-hidden />}
                      {FORMAT_LABEL[f]}
                    </a>
                  ))}
                </div>
              )}
            </div>
            <ReportDocView doc={q.data.data} narrative={q.data.narrative} />
          </>
        )}
      </main>
    </div>
  );
}
