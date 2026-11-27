import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  AlignmentType,
  ShadingType,
} from 'docx';
import ExcelJS from 'exceljs';
import {
  cellText,
  VERDICT_LABEL,
  type ReportCell,
  type ReportDoc,
  type ReportNarrative,
  type ReportSection,
  type Tone,
} from '@qaforge/shared';

const TONE_HEX: Record<Tone, string> = {
  good: '15803D',
  bad: 'B91C1C',
  warn: 'A16207',
  neutral: '475569',
};
const TONE_BG: Record<Tone, string> = {
  good: 'DCFCE7',
  bad: 'FEE2E2',
  warn: 'FEF3C7',
  neutral: 'F1F5F9',
};
const toneOf = (c: ReportCell): Tone | undefined =>
  c && typeof c === 'object' ? c.tone : undefined;

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }) + ' UTC';

// ---- HTML (PDF source) ---------------------------------------------------------------------

function htmlSection(s: ReportSection): string {
  const head = `<h2>${esc(s.title)}</h2>${s.description ? `<p class="muted">${esc(s.description)}</p>` : ''}`;
  if (s.kind === 'bars') {
    const max = s.max ?? Math.max(1, ...s.series.map((p) => p.value));
    if (!s.series.length) return `${head}<p class="muted">No data.</p>`;
    return `${head}<div class="bars">${s.series
      .map(
        (p) =>
          `<div class="bar"><span class="label">${esc(p.label)}</span><span class="track"><span class="fill" style="width:${Math.max(0, Math.min(100, (p.value / max) * 100))}%;background:#${TONE_HEX[p.tone ?? 'neutral']}"></span></span><span class="value">${p.value}${s.unit ?? ''}</span></div>`,
      )
      .join('')}</div>`;
  }
  if (!s.rows.length) return `${head}<p class="muted">${esc(s.empty ?? 'No rows.')}</p>`;
  const align = (a?: string) => (a ? ` style="text-align:${a}"` : '');
  return `${head}<table><thead><tr>${s.columns
    .map((c) => `<th${align(c.align)}>${esc(c.label)}</th>`)
    .join('')}</tr></thead><tbody>${s.rows
    .map(
      (r) =>
        `<tr>${s.columns
          .map((c) => {
            const v = r[c.key] ?? null;
            const t = toneOf(v);
            const text = esc(cellText(v));
            return `<td${align(c.align)}>${t ? `<span class="pill" style="color:#${TONE_HEX[t]};background:#${TONE_BG[t]}">${text}</span>` : text}</td>`;
          })
          .join('')}</tr>`,
    )
    .join(
      '',
    )}</tbody></table>${s.omitted ? `<p class="muted">${s.omitted} more rows in the Excel export.</p>` : ''}`;
}

/** A self-contained HTML page (no external assets), used for the PDF export. */
export function renderHtml(doc: ReportDoc, narrative?: ReportNarrative | null): string {
  const verdict = doc.verdict
    ? `<div class="verdict" style="border-color:#${TONE_HEX[doc.verdict.value === 'GO' ? 'good' : doc.verdict.value === 'NO_GO' ? 'bad' : 'warn']}"><strong>${VERDICT_LABEL[doc.verdict.value]}</strong> — ${esc(doc.verdict.reason)}</div>`
    : '';
  const story = narrative
    ? `<section class="story"><h2>Summary</h2><p>${esc(narrative.summary)}</p>${
        narrative.highlights.length
          ? `<h3>Highlights</h3><ul>${narrative.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`
          : ''
      }${narrative.risks.length ? `<h3>Risks</h3><ul>${narrative.risks.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}<h3>Recommendation</h3><p>${esc(narrative.recommendation)}</p><p class="muted">Written by the Report Agent from the numbers in this report.</p></section>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(doc.title)} · ${esc(doc.project.name)}</title><style>
*{box-sizing:border-box}body{font:12px/1.45 -apple-system,"Segoe UI",Inter,Roboto,Arial,sans-serif;color:#0f172a;margin:0;padding:28px}
h1{font-size:22px;margin:0}h2{font-size:15px;margin:22px 0 6px}h3{font-size:13px;margin:12px 0 4px}
.muted{color:#64748b;margin:2px 0 8px}.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #4f46e5;padding-bottom:10px}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin:14px 0}.kpi{border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px}
.kpi .l{color:#64748b;font-size:11px}.kpi .v{font-size:18px;font-weight:700}
.verdict{border-left:5px solid;padding:8px 12px;background:#f8fafc;margin:12px 0;font-size:14px}
table{width:100%;border-collapse:collapse;margin:4px 0}th,td{border-bottom:1px solid #e2e8f0;padding:4px 6px;text-align:left;vertical-align:top}
th{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;background:#f8fafc}tr{page-break-inside:avoid}
.pill{border-radius:99px;padding:1px 7px;font-weight:600;font-size:11px}
.bars{display:grid;gap:4px}.bar{display:grid;grid-template-columns:160px 1fr 60px;gap:8px;align-items:center}
.track{height:10px;background:#f1f5f9;border-radius:99px;overflow:hidden}.fill{display:block;height:100%}.value{text-align:right;font-variant-numeric:tabular-nums}
.story{border:1px solid #c7d2fe;background:#eef2ff;border-radius:8px;padding:4px 14px 10px;margin-top:14px}
</style></head><body>
<div class="top"><div><div class="muted">${esc(doc.project.name)} · QAForge</div><h1>${esc(doc.title)}</h1><div>${esc(doc.subtitle)}</div></div><div class="muted">Generated ${esc(fmtDate(doc.generatedAt))}</div></div>
${verdict}
<div class="kpis">${doc.kpis
    .map(
      (k) =>
        `<div class="kpi"><div class="l">${esc(k.label)}</div><div class="v" style="color:#${TONE_HEX[k.tone ?? 'neutral'] === TONE_HEX.neutral ? '0f172a' : TONE_HEX[k.tone!]}">${esc(String(k.value))}${k.unit ? `<small>${esc(k.unit)}</small>` : ''}</div></div>`,
    )
    .join('')}</div>
${story}
${doc.sections.map(htmlSection).join('\n')}
</body></html>`;
}

// ---- PDF ---------------------------------------------------------------------------------------

/** Renders the HTML with headless Chromium (the browser the runner already installs). */
export async function renderPdf(
  doc: ReportDoc,
  narrative?: ReportNarrative | null,
): Promise<Buffer> {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // No network: the page is self-contained, and nothing in a report should be fetched.
    await page.route('**/*', (r) => r.abort());
    await page.setContent(renderHtml(doc, narrative), { waitUntil: 'domcontentloaded' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-size:8px;color:#64748b;width:100%;text-align:center">${esc(doc.project.name)} · ${esc(doc.title)} · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
    });
  } finally {
    await browser.close();
  }
}

// ---- CSV ---------------------------------------------------------------------------------------

const csvCell = (s: string) => {
  // Neutralise spreadsheet formulas (CSV injection) and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** All tables, one after another, each with a title line; KPIs first. */
export function renderCsv(doc: ReportDoc): string {
  const lines: string[] = [];
  lines.push(csvCell(`${doc.title} — ${doc.subtitle}`));
  lines.push(['Metric', 'Value'].join(','));
  for (const k of doc.kpis)
    lines.push([csvCell(k.label), csvCell(`${k.value}${k.unit ?? ''}`)].join(','));
  for (const s of doc.sections) {
    lines.push('', csvCell(s.title));
    if (s.kind === 'bars') {
      lines.push('Label,Value');
      for (const p of s.series) lines.push([csvCell(p.label), String(p.value)].join(','));
    } else {
      lines.push(s.columns.map((c) => csvCell(c.label)).join(','));
      for (const r of s.rows)
        lines.push(s.columns.map((c) => csvCell(cellText(r[c.key] ?? null))).join(','));
    }
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---- XLSX --------------------------------------------------------------------------------------

export async function renderXlsx(
  doc: ReportDoc,
  narrative?: ReportNarrative | null,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QAForge';
  wb.created = new Date(doc.generatedAt);
  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 34 }, { width: 60 }];
  summary.addRow([doc.title]).font = { bold: true, size: 14 };
  summary.addRow([doc.subtitle]);
  summary.addRow([`${doc.project.name} · generated ${fmtDate(doc.generatedAt)}`]);
  if (doc.verdict)
    summary.addRow(['Verdict', `${VERDICT_LABEL[doc.verdict.value]} — ${doc.verdict.reason}`]);
  summary.addRow([]);
  for (const k of doc.kpis) summary.addRow([k.label, `${k.value}${k.unit ?? ''}`]);
  if (narrative) {
    summary.addRow([]);
    summary.addRow(['Summary (Report Agent)', narrative.summary]);
    narrative.highlights.forEach((h) => summary.addRow(['Highlight', h]));
    narrative.risks.forEach((h) => summary.addRow(['Risk', h]));
    summary.addRow(['Recommendation', narrative.recommendation]);
  }
  const used = new Set<string>(['Summary']);
  for (const s of doc.sections) {
    // Sheet names: max 31 chars, unique, no []:*?/\ characters.
    let name = s.title.replace(/[[\]:*?/\\]/g, ' ').slice(0, 28);
    for (let i = 2; used.has(name); i++) name = `${name.slice(0, 26)} ${i}`;
    used.add(name);
    const ws = wb.addWorksheet(name);
    if (s.kind === 'bars') {
      ws.columns = [
        { header: 'Label', width: 30 },
        { header: `Value${s.unit ? ` (${s.unit})` : ''}`, width: 14 },
      ];
      for (const p of s.series) ws.addRow([p.label, p.value]);
    } else {
      ws.columns = s.columns.map((c) => ({
        header: c.label,
        key: c.key,
        width: Math.min(60, Math.max(10, c.label.length + 4)),
      }));
      for (const r of s.rows) {
        const row = ws.addRow(
          s.columns.map((c) => {
            const v = r[c.key] ?? null;
            return typeof v === 'number' ? v : cellText(v);
          }),
        );
        s.columns.forEach((c, i) => {
          const t = toneOf(r[c.key] ?? null);
          if (t && t !== 'neutral')
            row.getCell(i + 1).font = { color: { argb: `FF${TONE_HEX[t]}` }, bold: true };
        });
      }
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
    }
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---- DOCX --------------------------------------------------------------------------------------

function docxCell(
  text: string,
  opts: { bold?: boolean; tone?: Tone; header?: boolean; align?: string } = {},
) {
  return new TableCell({
    children: [
      new Paragraph({
        alignment:
          opts.align === 'right'
            ? AlignmentType.RIGHT
            : opts.align === 'center'
              ? AlignmentType.CENTER
              : AlignmentType.LEFT,
        children: [
          new TextRun({
            text,
            bold: opts.bold || opts.header,
            size: 18,
            color: opts.tone ? TONE_HEX[opts.tone] : undefined,
          }),
        ],
      }),
    ],
    shading: opts.header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' } : undefined,
  });
}

export async function renderDocx(
  doc: ReportDoc,
  narrative?: ReportNarrative | null,
): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: `${doc.project.name} · QAForge`, style: 'Subtitle' }),
    new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: doc.subtitle }),
    new Paragraph({
      children: [
        new TextRun({ text: `Generated ${fmtDate(doc.generatedAt)}`, color: '64748B', size: 18 }),
      ],
    }),
  ];
  if (doc.verdict)
    children.push(
      new Paragraph({
        spacing: { before: 200 },
        children: [
          new TextRun({
            text: `${VERDICT_LABEL[doc.verdict.value]}: `,
            bold: true,
            size: 28,
            color:
              TONE_HEX[
                doc.verdict.value === 'GO' ? 'good' : doc.verdict.value === 'NO_GO' ? 'bad' : 'warn'
              ],
          }),
          new TextRun({ text: doc.verdict.reason, size: 24 }),
        ],
      }),
    );
  children.push(
    new Paragraph({ text: 'Key numbers', heading: HeadingLevel.HEADING_2 }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: doc.kpis.map(
        (k) =>
          new TableRow({
            children: [
              docxCell(k.label),
              docxCell(`${k.value}${k.unit ?? ''}`, { bold: true, tone: k.tone }),
            ],
          }),
      ),
    }),
  );
  if (narrative) {
    children.push(
      new Paragraph({ text: 'Summary', heading: HeadingLevel.HEADING_2 }),
      new Paragraph({ text: narrative.summary }),
    );
    if (narrative.highlights.length) {
      children.push(new Paragraph({ text: 'Highlights', heading: HeadingLevel.HEADING_3 }));
      narrative.highlights.forEach((h) =>
        children.push(new Paragraph({ text: h, bullet: { level: 0 } })),
      );
    }
    if (narrative.risks.length) {
      children.push(new Paragraph({ text: 'Risks', heading: HeadingLevel.HEADING_3 }));
      narrative.risks.forEach((h) =>
        children.push(new Paragraph({ text: h, bullet: { level: 0 } })),
      );
    }
    children.push(
      new Paragraph({ text: 'Recommendation', heading: HeadingLevel.HEADING_3 }),
      new Paragraph({ text: narrative.recommendation }),
      new Paragraph({
        children: [
          new TextRun({
            text: 'Written by the Report Agent from the numbers in this report.',
            italics: true,
            color: '64748B',
            size: 18,
          }),
        ],
      }),
    );
  }
  for (const s of doc.sections) {
    children.push(new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_2 }));
    if (s.description)
      children.push(
        new Paragraph({
          children: [new TextRun({ text: s.description, color: '64748B', size: 18 })],
        }),
      );
    if (s.kind === 'bars') {
      if (!s.series.length) children.push(new Paragraph({ text: 'No data.' }));
      else
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: s.series.map(
              (p) =>
                new TableRow({
                  children: [
                    docxCell(p.label),
                    docxCell(`${p.value}${s.unit ?? ''}`, { align: 'right', tone: p.tone }),
                  ],
                }),
            ),
          }),
        );
      continue;
    }
    if (!s.rows.length) {
      children.push(new Paragraph({ text: s.empty ?? 'No rows.' }));
      continue;
    }
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: s.columns.map((c) => docxCell(c.label, { header: true, align: c.align })),
          }),
          ...s.rows.map(
            (r) =>
              new TableRow({
                children: s.columns.map((c) => {
                  const v = r[c.key] ?? null;
                  return docxCell(cellText(v), { tone: toneOf(v), align: c.align });
                }),
              }),
          ),
        ],
      }),
    );
    if (s.omitted)
      children.push(new Paragraph({ text: `${s.omitted} more rows in the Excel export.` }));
  }
  const d = new Document({
    creator: 'QAForge',
    title: `${doc.title} · ${doc.project.name}`,
    sections: [{ children }],
  });
  return Packer.toBuffer(d);
}

export const EXPORT_CONTENT_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
} as const;

export async function renderExport(
  format: keyof typeof EXPORT_CONTENT_TYPES,
  doc: ReportDoc,
  narrative?: ReportNarrative | null,
): Promise<Buffer> {
  switch (format) {
    case 'pdf':
      return renderPdf(doc, narrative);
    case 'docx':
      return renderDocx(doc, narrative);
    case 'xlsx':
      return renderXlsx(doc, narrative);
    case 'csv':
      return Buffer.from(renderCsv(doc), 'utf8');
  }
}

/** File name like "go-no-go-pay-2026-11-27.pdf". */
export function exportFileName(doc: ReportDoc, format: string) {
  const slug = `${doc.title}-${doc.project.key}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug}-${doc.generatedAt.slice(0, 10)}.${format}`;
}
