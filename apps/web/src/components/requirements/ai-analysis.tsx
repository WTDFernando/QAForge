'use client';
import { AlertTriangle, CheckCircle2, CircleHelp, Copy, Plus, Quote } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AiJobButton } from '@/components/ai/ai-button';
import { useLatestJob } from '@/hooks/ai';
import type { RequirementDetail } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';

export interface AiAnalysis {
  ambiguities: string[];
  missingCriteria: string[];
  questions: string[];
  sourceQuote?: string;
  quoteVerified?: boolean | null;
  suggestedCriteria?: string[];
  at?: string;
}

function ScoreBar({ score }: { score: number }) {
  const tone = score >= 80 ? 'bg-success' : score >= 60 ? 'bg-warning' : 'bg-destructive';
  const label =
    score >= 80 ? 'Clear' : score >= 60 ? 'Testable with assumptions' : 'Too vague to test';
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">Clarity {score}/100</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Clarity score"
      >
        <div className={cn('h-full', tone)} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function List({
  icon: Icon,
  title,
  items,
  tone,
}: {
  icon: React.ElementType;
  title: string;
  items: string[];
  tone: string;
}) {
  if (!items.length) return null;
  return (
    <div className="grid gap-1">
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className={cn('size-3.5', tone)} /> {title}
      </h4>
      <ul className="grid gap-1 pl-5 text-sm">
        {items.map((x) => (
          <li key={x} className="list-disc">
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Requirement Agent findings. Suggestions are never applied automatically. */
export function AiAnalysisPanel({
  projectId,
  r,
  canEdit,
  onAddCriterion,
}: {
  projectId: string;
  r: RequirementDetail & { aiAnalysis?: AiAnalysis | null };
  canEdit: boolean;
  onAddCriterion: (c: string) => void;
}) {
  const job = useLatestJob(projectId, r.id, 'analyze-requirement');
  const a = r.aiAnalysis;
  const suggested = (a?.suggestedCriteria ?? []).filter((c) => !r.acceptanceCriteria.includes(c));
  const copyQuestions = () => {
    void navigator.clipboard.writeText(
      `Questions about ${r.ref} – ${r.title}\n\n${a!.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
    );
    toast.success('Questions copied');
  };

  return (
    <section
      aria-labelledby="ai-h"
      className="grid gap-3 rounded-lg border border-violet-500/20 bg-violet-500/[0.03] p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="ai-h" className="text-sm font-medium">
          AI assessment
        </h3>
        {canEdit && (
          <AiJobButton
            projectId={projectId}
            agent="requirement"
            input={{ kind: 'analyze-requirement', requirementId: r.id }}
            job={job}
            label={a ? 'Re-assess' : 'Assess clarity'}
          />
        )}
      </div>
      {!a ? (
        <p className="text-sm text-muted-foreground">
          Ask the Requirement Agent to score how testable this is and list what to clarify with the
          client.
        </p>
      ) : (
        <>
          {r.clarityScore !== null && <ScoreBar score={r.clarityScore} />}
          <List
            icon={AlertTriangle}
            tone="text-warning-text"
            title="Ambiguities"
            items={a.ambiguities}
          />
          <List
            icon={AlertTriangle}
            tone="text-warning-text"
            title="Missing acceptance criteria"
            items={a.missingCriteria}
          />
          {a.questions.length > 0 && (
            <div className="grid gap-1">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <CircleHelp className="size-3.5 text-primary" /> Questions for the client
                </h4>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={copyQuestions}
                >
                  <Copy className="size-3" /> Copy
                </Button>
              </div>
              <ol className="grid gap-1 pl-5 text-sm">
                {a.questions.map((q) => (
                  <li key={q} className="list-decimal">
                    {q}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {suggested.length > 0 && canEdit && (
            <div className="grid gap-1">
              <h4 className="text-xs font-medium text-muted-foreground">
                Suggested acceptance criteria
              </h4>
              {suggested.map((c) => (
                <div
                  key={c}
                  className="flex items-start gap-2 rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  <span className="flex-1">{c}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => onAddCriterion(c)}
                  >
                    <Plus className="size-3" /> Add
                  </Button>
                </div>
              ))}
            </div>
          )}
          {a.sourceQuote && (
            <figure className="grid gap-1 text-sm">
              <figcaption className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Quote className="size-3.5" /> Source
                {a.quoteVerified === true && (
                  <Badge variant="success">
                    <CheckCircle2 className="size-3" /> Quote found in document
                  </Badge>
                )}
                {a.quoteVerified === false && (
                  <Badge variant="warning">Quote not found in document: verify</Badge>
                )}
              </figcaption>
              <blockquote className="border-l-2 pl-3 text-muted-foreground italic">
                {a.sourceQuote}
              </blockquote>
            </figure>
          )}
          {a.at && <p className="text-[11px] text-muted-foreground">Assessed {timeAgo(a.at)}</p>}
        </>
      )}
    </section>
  );
}
