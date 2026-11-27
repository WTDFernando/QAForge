import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { ReportDoc } from '@qaforge/shared';
import {
  exportFileName,
  renderCsv,
  renderDocx,
  renderExport,
  renderHtml,
  renderXlsx,
} from './index';

const doc: ReportDoc = {
  version: 1,
  type: 'GO_NO_GO',
  title: 'Go / No-Go',
  subtitle: 'REL-0001 Spring release (2.4.0)',
  project: { name: 'Payments', key: 'PAY' },
  generatedAt: '2026-11-27T09:00:00.000Z',
  verdict: { value: 'NO_GO', reason: '1 blocking quality gate not met' },
  kpis: [
    { label: 'Readiness', value: 72, unit: '/100', tone: 'warn' },
    { label: 'Pass rate', value: '91.5%', tone: 'warn' },
  ],
  sections: [
    {
      kind: 'table',
      title: 'Open bugs',
      columns: [
        { key: 'bug', label: 'Bug' },
        { key: 'title', label: 'Title' },
        { key: 'severity', label: 'Severity' },
      ],
      rows: [
        {
          bug: 'BUG-0003',
          title: '=HYPERLINK("http://evil")',
          severity: { text: 'critical', tone: 'bad' },
        },
        {
          bug: 'BUG-0007',
          title: 'Totals, "rounded" <wrong>',
          severity: { text: 'major', tone: 'warn' },
        },
      ],
      omitted: 4,
    },
    {
      kind: 'bars',
      title: 'Results by status',
      series: [
        { label: 'Passed', value: 43, tone: 'good' },
        { label: 'Failed', value: 4, tone: 'bad' },
      ],
    },
    {
      kind: 'table',
      title: 'Sign-off',
      columns: [{ key: 'who', label: 'Approver' }],
      rows: [],
      empty: 'No approvers named yet.',
    },
  ],
};
const narrative = {
  summary: 'Pass rate is 91.5% with 4 failures.',
  highlights: ['43 cases passed'],
  risks: ['BUG-0003 is critical'],
  recommendation: 'Hold the release until BUG-0003 is fixed.',
};

describe('report renderers', () => {
  it('renders self-contained, escaped HTML with the verdict and narrative', () => {
    const html = renderHtml(doc, narrative);
    expect(html).toContain('No-go</strong> — 1 blocking quality gate not met');
    expect(html).toContain('Totals, &quot;rounded&quot; &lt;wrong&gt;');
    expect(html).not.toMatch(/<(script|link|img)\b/);
    expect(html).toContain('4 more rows in the Excel export');
    expect(html).toContain('Hold the release until BUG-0003 is fixed.');
    expect(html).toContain('No approvers named yet.');
  });

  it('writes CSV that spreadsheets can’t execute', () => {
    const csv = renderCsv(doc);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"Totals, ""rounded"" <wrong>"');
    expect(csv).toContain('Passed,43');
  });

  it('writes an XLSX with a summary sheet and one sheet per section', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderXlsx(doc, narrative)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Summary',
      'Open bugs',
      'Results by status',
      'Sign-off',
    ]);
    expect(wb.getWorksheet('Open bugs')!.getRow(2).getCell(1).value).toBe('BUG-0003');
    expect(wb.getWorksheet('Results by status')!.getRow(2).values).toContain(43);
    expect(wb.getWorksheet('Summary')!.getColumn(2).values).toContain(
      'Hold the release until BUG-0003 is fixed.',
    );
  });

  it('writes a DOCX and a PDF', async () => {
    const docx = await renderDocx(doc, narrative);
    expect(docx.subarray(0, 2).toString()).toBe('PK');
    const pdf = await renderExport('pdf', doc, narrative);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
  }, 60_000);

  it('names files after the report and project', () => {
    expect(exportFileName(doc, 'pdf')).toBe('go-no-go-pay-2026-11-27.pdf');
  });
});
