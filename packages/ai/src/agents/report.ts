import { z } from 'zod';
import {
  cellText,
  documentNumbers,
  normalizeNumber,
  VERDICT_LABEL,
  type ReportDoc,
} from '@qaforge/shared';
import { tagSafe, type AgentDefinition } from './types';

export const reportInput = z.object({
  /** The frozen report document (numbers from the database). */
  doc: z.custom<ReportDoc>((v) => !!v && typeof v === 'object' && 'kpis' in (v as object)),
  audience: z.enum(['team', 'stakeholders']).default('stakeholders'),
});
export type ReportAgentInput = z.infer<typeof reportInput>;

export const reportOutput = z.object({
  summary: z.string(),
  highlights: z.array(z.string()).max(6),
  risks: z.array(z.string()).max(6),
  recommendation: z.string(),
});
export type ReportAgentOutput = z.infer<typeof reportOutput>;

/** Tables are cut to keep the prompt small; the agent still sees every KPI. */
const ROWS_PER_TABLE = 40;

export function reportAsText(doc: ReportDoc): string {
  const lines = [
    `Report: ${doc.title}`,
    `Scope: ${doc.subtitle}`,
    `Project: ${doc.project.name}`,
    doc.period ? `Period: ${doc.period.from} to ${doc.period.to}` : '',
    doc.verdict
      ? `Verdict (computed by rules): ${VERDICT_LABEL[doc.verdict.value]} — ${doc.verdict.reason}`
      : '',
    '',
    'Key numbers:',
    ...doc.kpis.map((k) => `- ${k.label}: ${k.value}${k.unit ?? ''}`),
  ];
  for (const s of doc.sections) {
    lines.push('', `## ${s.title}${s.description ? ` (${s.description})` : ''}`);
    if (s.kind === 'bars') {
      lines.push(...s.series.map((p) => `- ${p.label}: ${p.value}${s.unit ?? ''}`));
      continue;
    }
    if (!s.rows.length) {
      lines.push(s.empty ?? 'No rows.');
      continue;
    }
    lines.push(s.columns.map((c) => c.label).join(' | '));
    for (const r of s.rows.slice(0, ROWS_PER_TABLE))
      lines.push(s.columns.map((c) => cellText(r[c.key] ?? null)).join(' | '));
    const more = s.rows.length - ROWS_PER_TABLE + (s.omitted ?? 0);
    if (more > 0) lines.push(`(${more} more rows not shown)`);
  }
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

/** Numbers written in the text, ignoring those inside item refs like BUG-0012 (checked separately). */
function numbersIn(text: string): string[] {
  const withoutRefs = text.replace(/\b[A-Z]{2,4}-\d{1,6}\b/g, ' ');
  return [...withoutRefs.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => normalizeNumber(m[0]));
}

/** Split after . ! ? followed by a space, so decimals like 91.5% stay in one sentence. */
const sentences = (t: string) =>
  t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

export const reportAgent: AgentDefinition<typeof reportInput, typeof reportOutput> = {
  id: 'report',
  name: 'Report Agent',
  description:
    'Writes a short summary, risks and a recommendation for a report, using only its numbers.',
  promptVersion: 'v1',
  effort: 'low',
  input: reportInput,
  output: reportOutput,
  buildContent(input) {
    return [
      {
        type: 'text',
        text: `<report audience="${input.audience}">\n${tagSafe(reportAsText(input.doc))}\n</report>`,
      },
    ];
  },
  /**
   * Numbers only from the database: every number and item ref the agent writes must appear in the
   * report. Sentences that don't are removed (and reported), never "fixed".
   */
  postprocess(input, out) {
    const dropped: string[] = [];
    const allowed = documentNumbers(input.doc);
    const text = reportAsText(input.doc);
    const refs = new Set(text.match(/\b[A-Z]{2,4}-\d{1,6}\b/g) ?? []);
    const grounded = (s: string) => {
      const badNum = numbersIn(s).find((n) => !allowed.has(n));
      const badRef = (s.match(/\b[A-Z]{2,4}-\d{1,6}\b/g) ?? []).find((r) => !refs.has(r));
      if (badNum || badRef) {
        dropped.push(
          `removed "${s.slice(0, 80)}": ${badRef ? `${badRef} is not in the report` : `${badNum} is not a number in the report`}`,
        );
        return false;
      }
      return true;
    };
    const clean = (t: string) => sentences(t).filter(grounded).join(' ');
    let recommendation = clean(out.recommendation);
    // The verdict is computed by rules; the narrative may explain it, never overrule it.
    if (
      input.doc.verdict?.value === 'NO_GO' &&
      /\b(go ahead|ready to (ship|release)|safe to (ship|release)|approve (the|this) release|recommend (shipping|releasing))\b/i.test(
        recommendation,
      )
    ) {
      dropped.push('the recommendation contradicted the No-go verdict');
      recommendation = '';
    }
    const fallback = input.doc.verdict
      ? `${VERDICT_LABEL[input.doc.verdict.value]}: ${input.doc.verdict.reason}.`
      : 'See the numbers below.';
    return {
      output: {
        summary: clean(out.summary) || fallback,
        highlights: out.highlights.filter(grounded).slice(0, 5),
        risks: out.risks.filter(grounded).slice(0, 5),
        recommendation: recommendation || fallback,
      },
      dropped,
    };
  },
};
