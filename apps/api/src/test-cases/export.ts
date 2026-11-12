import ExcelJS from 'exceljs';
import { humanize } from '@qaforge/shared';

export interface ExportRow {
  ref: string;
  title: string;
  suite: { name: string } | null;
  status: string;
  priority: string;
  type: string;
  technique: string | null;
  automationStatus: string;
  tags: string[];
  requirements: { ref: string }[];
  preconditions: string;
  steps: {
    action: string;
    expected: string;
    sharedStep: { name: string; steps: unknown } | null;
  }[];
  updatedAt: Date;
}

const COLUMNS = [
  'ID',
  'Title',
  'Suite',
  'Status',
  'Priority',
  'Type',
  'Technique',
  'Automation',
  'Tags',
  'Requirements',
  'Preconditions',
  'Steps',
  'Expected results',
  'Updated',
];

function expandSteps(steps: ExportRow['steps']) {
  const out: { action: string; expected: string }[] = [];
  for (const s of steps) {
    if (s.sharedStep) {
      for (const inner of s.sharedStep.steps as { action: string; expected: string }[])
        out.push(inner);
    } else out.push(s);
  }
  return out;
}

function toRecord(r: ExportRow): string[] {
  const steps = expandSteps(r.steps);
  return [
    r.ref,
    r.title,
    r.suite?.name ?? '',
    humanize(r.status),
    humanize(r.priority),
    humanize(r.type),
    r.technique ? humanize(r.technique) : '',
    humanize(r.automationStatus),
    r.tags.join(', '),
    r.requirements.map((x) => x.ref).join(', '),
    r.preconditions,
    steps.map((s, i) => `${i + 1}. ${s.action}`).join('\n'),
    steps.map((s, i) => `${i + 1}. ${s.expected}`).join('\n'),
    r.updatedAt.toISOString(),
  ];
}

/** RFC 4180 CSV; cells starting with = + - @ are prefixed to block spreadsheet formula injection. */
export function toCsv(rows: ExportRow[]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return (
    '﻿' + [COLUMNS, ...rows.map(toRecord)].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
  );
}

export async function toXlsx(rows: ExportRow[], sheetName = 'Test cases'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QAForge';
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map((header, i) => ({
    header,
    key: String(i),
    width: [12, 50, 20, 12, 10, 14, 16, 16, 20, 18, 40, 60, 60, 22][i],
  }));
  for (const r of rows) {
    // ExcelJS writes strings as text (never formulas), so no injection risk here.
    ws.addRow(toRecord(r)).alignment = { wrapText: true, vertical: 'top' };
  }
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNS.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
