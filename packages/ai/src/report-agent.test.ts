import { describe, expect, it } from 'vitest';
import type { ReportDoc } from '@qaforge/shared';
import { FakeProvider, reportAgent, reportAsText, runAgent } from './index';

const doc: ReportDoc = {
  version: 1,
  type: 'GO_NO_GO',
  title: 'Go / No-Go',
  subtitle: 'REL-0003 Spring release (2.4.0)',
  project: { name: 'Payments', key: 'PAY' },
  generatedAt: '2026-11-27T09:00:00.000Z',
  verdict: { value: 'NO_GO', reason: '1 blocking quality gate not met' },
  kpis: [
    { label: 'Readiness', value: 72, unit: '/100' },
    { label: 'Pass rate', value: '91.5%' },
    { label: 'Executed', value: '47 of 50' },
  ],
  sections: [
    {
      kind: 'table',
      title: 'Open bugs',
      columns: [
        { key: 'bug', label: 'Bug' },
        { key: 'title', label: 'Title' },
      ],
      rows: [{ bug: 'BUG-0012', title: 'Card declined for valid card' }],
    },
  ],
};

const run = (out: object) =>
  runAgent(
    reportAgent,
    { doc, audience: 'stakeholders' },
    { provider: new FakeProvider(() => out), model: 'm' },
  );

describe('Report Agent', () => {
  it('sends the report as data, including the rules-based verdict', async () => {
    let text = '';
    await runAgent(
      reportAgent,
      { doc, audience: 'team' },
      {
        provider: new FakeProvider((req) => {
          text = req.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
          return { summary: 'ok', highlights: [], risks: [], recommendation: 'ok' };
        }),
        model: 'm',
      },
    );
    expect(text).toContain('<report audience="team">');
    expect(text).toContain('Verdict (computed by rules): No-go — 1 blocking quality gate not met');
    expect(text).toContain('BUG-0012 | Card declined for valid card');
  });

  it('keeps sentences whose numbers and refs come from the report', async () => {
    const r = await run({
      summary: 'Pass rate is 91.5% with 47 of 50 cases executed. Readiness is 72 out of 100.',
      highlights: ['47 cases were executed.'],
      risks: ['BUG-0012 is still open.'],
      recommendation: 'Fix BUG-0012 before release.',
    });
    expect(r.dropped).toEqual([]);
    expect(r.output.summary).toBe(
      'Pass rate is 91.5% with 47 of 50 cases executed. Readiness is 72 out of 100.',
    );
  });

  it('removes sentences with invented numbers or refs', async () => {
    const r = await run({
      summary: 'Pass rate is 91.5%. That is up 12% from last week.',
      highlights: ['About 95% of cases passed.', '47 cases were executed.'],
      risks: ['BUG-0099 could block payments.', 'BUG-0012 is still open.'],
      recommendation: 'Fix BUG-0012.',
    });
    expect(r.output.summary).toBe('Pass rate is 91.5%.');
    expect(r.output.highlights).toEqual(['47 cases were executed.']);
    expect(r.output.risks).toEqual(['BUG-0012 is still open.']);
    expect(r.dropped).toHaveLength(3);
    expect(r.dropped.join('\n')).toMatch(/12 is not a number in the report/);
    expect(r.dropped.join('\n')).toMatch(/BUG-0099 is not in the report/);
  });

  it('never lets the narrative overrule a No-go verdict', async () => {
    const r = await run({
      summary: 'Pass rate is 91.5%.',
      highlights: [],
      risks: [],
      recommendation: 'The release is ready to ship.',
    });
    expect(r.output.recommendation).toBe('No-go: 1 blocking quality gate not met.');
    expect(r.dropped).toContain('the recommendation contradicted the No-go verdict');
  });

  it('falls back to the verdict when nothing grounded is left', async () => {
    const r = await run({
      summary: 'Coverage reached 88%.',
      highlights: [],
      risks: [],
      recommendation: 'Ship by 5 December.',
    });
    expect(r.output.summary).toBe('No-go: 1 blocking quality gate not met.');
    expect(r.output.recommendation).toBe('No-go: 1 blocking quality gate not met.');
  });

  it('cuts long tables in the prompt', () => {
    const big: ReportDoc = {
      ...doc,
      sections: [
        {
          kind: 'table',
          title: 'Rows',
          columns: [{ key: 'n', label: 'N' }],
          rows: Array.from({ length: 100 }, (_, i) => ({ n: i })),
          omitted: 20,
        },
      ],
    };
    expect(reportAsText(big)).toContain('(80 more rows not shown)');
  });
});
