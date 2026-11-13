import ExcelJS from 'exceljs';
import mammoth from 'mammoth';

export type ExtractedDocument =
  | { kind: 'text'; text: string }
  | { kind: 'pdf'; base64: string }
  | { kind: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string };

/** Max characters of extracted text sent to the model (~120k tokens). Larger documents fail with a clear message. */
export const MAX_TEXT_CHARS = 450_000;

export class UnsupportedDocumentError extends Error {}

/** Turn an uploaded file into something the model can read. PDFs and images go to the model natively. */
export async function extractDocument(
  buffer: Buffer,
  contentType: string,
  fileName: string,
): Promise<ExtractedDocument> {
  switch (contentType) {
    case 'text/markdown':
    case 'text/plain':
      return checkSize({ kind: 'text', text: buffer.toString('utf8') }, fileName);
    case 'application/pdf':
      return { kind: 'pdf', base64: buffer.toString('base64') };
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
      return { kind: 'image', mediaType: contentType, base64: buffer.toString('base64') };
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const { value } = await mammoth.extractRawText({ buffer });
      return checkSize({ kind: 'text', text: value }, fileName);
    }
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      const sheets = wb.worksheets.map((ws) => {
        const rows: string[] = [];
        ws.eachRow((row) => {
          const values = (row.values as unknown[]).slice(1).map((v) => cellText(v));
          if (values.some(Boolean)) rows.push(values.join(' | '));
        });
        return `## Sheet: ${ws.name}\n${rows.join('\n')}`;
      });
      return checkSize({ kind: 'text', text: sheets.join('\n\n') }, fileName);
    }
    default:
      throw new UnsupportedDocumentError(`"${fileName}" (${contentType}) can't be analyzed`);
  }
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join('');
    if (o.text) return o.text;
    if (o.result !== undefined) return String(o.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).replace(/\s+/g, ' ').trim();
}

function checkSize(doc: { kind: 'text'; text: string }, fileName: string): ExtractedDocument {
  if (!doc.text.trim()) throw new UnsupportedDocumentError(`"${fileName}" has no readable text`);
  if (doc.text.length > MAX_TEXT_CHARS)
    throw new UnsupportedDocumentError(
      `"${fileName}" is too long to analyze in one pass; split it into smaller documents`,
    );
  return doc;
}
