import { Sparkles } from 'lucide-react';
import {
  cellText,
  VERDICT_LABEL,
  type ReportCell,
  type ReportDoc,
  type ReportNarrative,
  type ReportSection,
  type Tone,
} from '@qaforge/shared';
import { cn } from '@/lib/utils';

export const TONE_TEXT: Record<Tone, string> = {
  good: 'text-success-text',
  bad: 'text-destructive-text',
  warn: 'text-warning-text',
  neutral: 'text-foreground',
};
const TONE_PILL: Record<Tone, string> = {
  good: 'bg-success-subtle text-success-text',
  bad: 'bg-destructive-subtle text-destructive-text',
  warn: 'bg-warning-subtle text-warning-text',
  neutral: 'bg-muted text-muted-foreground',
};
const TONE_BAR: Record<Tone, string> = {
  good: 'bg-success',
  bad: 'bg-destructive',
  warn: 'bg-warning',
  neutral: 'bg-muted-foreground/60',
};

function Cell({ value }: { value: ReportCell }) {
  if (value && typeof value === 'object' && value.tone)
    return (
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
          TONE_PILL[value.tone],
        )}
      >
        {value.text}
      </span>
    );
  return <>{cellText(value)}</>;
}

function Section({ s }: { s: ReportSection }) {
  const id = `sec-${s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  if (s.kind === 'bars') {
    const max = s.max ?? Math.max(1, ...s.series.map((p) => p.value));
    return (
      <section aria-labelledby={id} className="rounded-xl border bg-card p-4">
        <h2 id={id} className="text-sm font-semibold">
          {s.title}
        </h2>
        {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
        {s.series.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No data.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {s.series.map((p) => (
              <li
                key={p.label}
                className="grid grid-cols-[minmax(6rem,10rem)_1fr_4rem] items-center gap-3 text-sm"
              >
                <span className="truncate">{p.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span
                    className={cn('block h-full rounded-full', TONE_BAR[p.tone ?? 'neutral'])}
                    style={{ width: `${Math.max(0, Math.min(100, (p.value / max) * 100))}%` }}
                  />
                </span>
                <span className="text-right font-mono text-xs tabular-nums">
                  {p.value}
                  {s.unit}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h2 id={id} className="text-sm font-semibold">
          {s.title}
        </h2>
        {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
      </div>
      {s.rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{s.empty ?? 'No rows.'}</p>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${s.title} table`}>
          <table className="w-full text-sm">
            <thead className="bg-background text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <tr>
                {s.columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={cn('px-4 py-2 font-semibold', c.align === 'right' && 'text-right')}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r, i) => (
                <tr key={i} className="border-t align-top">
                  {s.columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn('px-4 py-2', c.align === 'right' && 'text-right tabular-nums')}
                    >
                      <Cell value={r[c.key] ?? null} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!s.omitted && (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          {s.omitted} more rows in the Excel export.
        </p>
      )}
    </section>
  );
}

export function NarrativeCard({
  narrative,
  actions,
}: {
  narrative: ReportNarrative;
  actions?: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="summary-h"
      className="rounded-xl border border-primary/40 bg-primary-subtle/50 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h2 id="summary-h" className="text-sm font-semibold">
          Summary
        </h2>
        <span className="text-xs text-muted-foreground">
          Report Agent · numbers from this report only
        </span>
        {actions && <span className="ml-auto">{actions}</span>}
      </div>
      <p className="mt-2 text-sm leading-relaxed">{narrative.summary}</p>
      {(narrative.highlights.length > 0 || narrative.risks.length > 0) && (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {narrative.highlights.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-success-text">Highlights</h3>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {narrative.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          )}
          {narrative.risks.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-destructive-text">Risks</h3>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {narrative.risks.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <p className="mt-3 text-sm font-medium">Recommendation: {narrative.recommendation}</p>
    </section>
  );
}

/** Verdict, key numbers, optional AI summary and every section of a report. */
export function ReportDocView({
  doc,
  narrative,
  summarySlot,
}: {
  doc: ReportDoc;
  narrative?: ReportNarrative | null;
  /** Shown where the summary goes when there is no narrative (e.g. a "Write summary" button). */
  summarySlot?: React.ReactNode;
}) {
  const v = doc.verdict;
  const vTone: Tone = v
    ? v.value === 'GO'
      ? 'good'
      : v.value === 'NO_GO'
        ? 'bad'
        : 'warn'
    : 'neutral';
  return (
    <div className="grid gap-4">
      {v && (
        <div
          role="status"
          className={cn(
            'flex items-center gap-3 rounded-xl border-l-4 px-4 py-3',
            vTone === 'good'
              ? 'border-success bg-success-subtle'
              : vTone === 'bad'
                ? 'border-destructive bg-destructive-subtle'
                : 'border-warning bg-warning-subtle',
          )}
        >
          <div>
            <div className={cn('text-base font-bold', TONE_TEXT[vTone])}>
              {VERDICT_LABEL[v.value]}
            </div>
            <div className={cn('text-sm', TONE_TEXT[vTone])}>{v.reason}</div>
          </div>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {doc.kpis.map((k) => (
          <div key={k.label} className="rounded-xl border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{k.label}</dt>
            <dd className={cn('text-xl font-bold tabular-nums', TONE_TEXT[k.tone ?? 'neutral'])}>
              {k.value}
              {k.unit && (
                <span className="text-sm font-medium text-muted-foreground">{k.unit}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {narrative ? <NarrativeCard narrative={narrative} /> : summarySlot}
      <div className="grid gap-4 xl:grid-cols-2">
        {doc.sections.map((s) => (
          <div
            key={s.title}
            className={cn(s.kind === 'table' && s.columns.length > 4 && 'xl:col-span-2')}
          >
            <Section s={s} />
          </div>
        ))}
      </div>
    </div>
  );
}
