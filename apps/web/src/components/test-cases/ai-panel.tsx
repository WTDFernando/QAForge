'use client';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, CopyCheck, Sparkles, Wand2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AiJobButton } from '@/components/ai/ai-button';
import { useLatestJob } from '@/hooks/ai';
import type { TestCaseDetail } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';

const SEVERITY: Record<string, string> = {
  high: 'bg-destructive/15 text-destructive',
  medium: 'bg-warning/20 text-warning-text',
  low: 'bg-muted text-muted-foreground',
};

/** Writer rationale + duplicate warnings + reviewer findings. Nothing here changes the test case by itself. */
export function TestCaseAiPanel({
  projectId,
  basePath,
  t,
  canEdit,
  onUseSteps,
}: {
  projectId: string;
  basePath: string;
  t: TestCaseDetail;
  canEdit: boolean;
  onUseSteps: (steps: { action: string; expected: string }[]) => void;
}) {
  const job = useLatestJob(projectId, t.id, 'review-test-case');
  const notes = t.aiNotes ?? {};
  const review = notes.review;
  const stale = review && review.version < t.version;

  return (
    <section
      aria-labelledby="tc-ai-h"
      className="grid gap-3 rounded-lg border border-violet-500/20 bg-violet-500/[0.03] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="tc-ai-h" className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-4 text-violet-500" /> AI
        </h2>
        <AiJobButton
          projectId={projectId}
          agent="test-case-reviewer"
          input={{ kind: 'review-test-case', testCaseId: t.id }}
          job={job}
          label={review ? 'Review again' : 'Review with AI'}
        />
      </div>

      {t.aiGenerated && (
        <div className="grid gap-1.5 text-sm">
          <p>
            Drafted by the Test Case Writer
            {t.aiConfidence != null && (
              <>
                {' '}
                with <strong>{Math.round(t.aiConfidence * 100)}% confidence</strong>
              </>
            )}
            .{t.status === 'DRAFT' && ' Review the steps, then approve or reject it.'}
          </p>
          {notes.rationale && <p className="text-muted-foreground">{notes.rationale}</p>}
          {!!notes.coversCriteria?.length && (
            <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              Covers{' '}
              {notes.coversCriteria.map((c) => (
                <Badge key={c} variant="outline">
                  {c}
                </Badge>
              ))}
            </p>
          )}
        </div>
      )}

      {!!notes.duplicates?.length && (
        <div
          className="grid gap-1 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-sm"
          role="note"
        >
          <p className="flex items-center gap-1.5 font-medium">
            <CopyCheck className="size-4 text-warning-text" /> Possible duplicate
          </p>
          <ul className="grid gap-0.5">
            {notes.duplicates.map((d) => (
              <li key={d.ref}>
                <Link href={`${basePath}/test-cases/${d.ref}`} className="hover:underline">
                  <span className="font-mono text-xs">{d.ref}</span> {d.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {' '}
                  · {Math.round(d.similarity * 100)}% similar title
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {review ? (
        <div className="grid gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {review.verdict === 'good' ? (
              <Badge variant="success">
                <CheckCircle2 className="size-3" /> Looks good
              </Badge>
            ) : (
              <Badge variant="warning">
                <AlertTriangle className="size-3" /> Needs changes
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              Score {review.score}/100 · reviewed {timeAgo(review.at)}
            </span>
            {stale && <Badge variant="outline">Older version (v{review.version})</Badge>}
          </div>
          {review.summary && <p className="text-muted-foreground">{review.summary}</p>}
          {review.issues.length > 0 && (
            <ul className="grid gap-1.5">
              {review.issues.map((i, n) => (
                <li key={n} className="rounded-md border bg-background p-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className={cn('rounded px-1.5 py-0.5 font-medium', SEVERITY[i.severity])}>
                      {i.severity}
                    </span>
                    {i.stepNumber !== null && (
                      <span className="text-muted-foreground">Step {i.stepNumber}</span>
                    )}
                  </div>
                  <p className="mt-1">{i.message}</p>
                  <p className="text-muted-foreground">→ {i.suggestion}</p>
                </li>
              ))}
            </ul>
          )}
          {review.missingCoverage.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Not covered</p>
              <ul className="list-disc pl-5">
                {review.missingCoverage.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {canEdit && review.suggestedSteps && review.suggestedSteps.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => onUseSteps(review.suggestedSteps!)}
            >
              <Wand2 /> Use suggested steps ({review.suggestedSteps.length})
            </Button>
          )}
        </div>
      ) : (
        !t.aiGenerated && (
          <p className="text-sm text-muted-foreground">
            Ask the Test Case Reviewer to check for vague steps, missing expected results and
            coverage gaps.
          </p>
        )
      )}
    </section>
  );
}
