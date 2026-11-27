import type { ReportType } from './releases';

/**
 * One format-neutral document per report. Builders fill it from the database; the HTML/PDF,
 * DOCX, XLSX, CSV renderers and the web page all draw the same thing.
 */
export type Tone = 'good' | 'bad' | 'warn' | 'neutral';

export type ReportCell = string | number | null | { text: string; tone?: Tone };

export interface ReportKpi {
  label: string;
  value: string | number;
  unit?: string;
  tone?: Tone;
  hint?: string;
}

export interface ReportTable {
  kind: 'table';
  title: string;
  description?: string;
  columns: { key: string; label: string; align?: 'left' | 'right' | 'center' }[];
  rows: Record<string, ReportCell>[];
  /** Rows left out to keep the report readable */
  omitted?: number;
  empty?: string;
}

export interface ReportBars {
  kind: 'bars';
  title: string;
  description?: string;
  unit?: string;
  /** Upper bound of the scale (defaults to the largest value) */
  max?: number;
  series: { label: string; value: number; tone?: Tone }[];
}

export type ReportSection = ReportTable | ReportBars;

export type Verdict = 'GO' | 'GO_WITH_RISKS' | 'NO_GO';

export interface ReportDoc {
  version: 1;
  type: ReportType;
  title: string;
  subtitle: string;
  project: { name: string; key: string };
  generatedAt: string;
  period?: { from: string; to: string };
  verdict?: { value: Verdict; reason: string };
  kpis: ReportKpi[];
  sections: ReportSection[];
}

/** Report Agent output; every number in it must appear in the report data. */
export interface ReportNarrative {
  summary: string;
  highlights: string[];
  risks: string[];
  recommendation: string;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  GO: 'Go',
  GO_WITH_RISKS: 'Go with risks',
  NO_GO: 'No-go',
};

export function cellText(c: ReportCell): string {
  if (c === null || c === undefined) return '';
  if (typeof c === 'object') return c.text;
  return String(c);
}

/** Every number that appears in the document: the Report Agent may only use these. */
export function documentNumbers(doc: ReportDoc): Set<string> {
  const out = new Set<string>();
  const add = (s: string | number) => {
    // Item refs (BUG-0012) are checked as refs, not as the number 12.
    const text = String(s).replace(/\b[A-Z]{2,4}-\d{1,6}\b/g, ' ');
    for (const m of text.matchAll(/\d+(?:[.,]\d+)?/g)) out.add(normalizeNumber(m[0]));
  };
  for (const k of doc.kpis) {
    add(k.value);
    if (k.unit) add(k.unit);
  }
  for (const s of doc.sections) {
    if (s.kind === 'bars') for (const p of s.series) add(p.value);
    else {
      for (const r of s.rows) for (const c of Object.values(r)) add(cellText(c));
      add(s.rows.length + (s.omitted ?? 0));
    }
  }
  add(doc.title);
  add(doc.subtitle);
  if (doc.verdict) add(doc.verdict.reason);
  if (doc.period) {
    add(doc.period.from);
    add(doc.period.to);
  }
  return out;
}

export function normalizeNumber(s: string): string {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? String(n) : s;
}
