import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

/** Resolve an item ID to a link target (REQ ids need a lookup, TC ids route by ref). */
export type RefResolver = (ref: string) => string | null;

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\b(?:REQ|TC)-\d{4,}\b)/g;

function inline(text: string, resolve: RefResolver): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <code key={i} className="rounded bg-muted px-1 font-mono text-xs">
          {part.slice(1, -1)}
        </code>
      );
    if (/^(REQ|TC)-\d{4,}$/.test(part)) {
      const href = resolve(part);
      return href ? (
        <Link
          key={i}
          href={href}
          className="font-mono text-xs font-medium text-primary hover:underline"
        >
          {part}
        </Link>
      ) : (
        <span key={i} className="font-mono text-xs">
          {part}
        </span>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** Minimal, safe Markdown (paragraphs, bullet/numbered lists, bold, code, item links). No HTML is ever injected. */
export function renderCopilotMarkdown(md: string, resolve: RefResolver): ReactNode {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={blocks.length} className={list.ordered ? 'list-decimal pl-5' : 'list-disc pl-5'}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it, resolve)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(
      heading ? (
        <p key={blocks.length} className="font-semibold">
          {inline(heading[1]!, resolve)}
        </p>
      ) : (
        <p key={blocks.length}>{inline(line, resolve)}</p>
      ),
    );
  }
  flush();
  return <div className="grid gap-2">{blocks}</div>;
}
