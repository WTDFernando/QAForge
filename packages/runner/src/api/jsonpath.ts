/**
 * Small JSONPath subset used by assertions and extraction:
 * $.a.b, $.items[0].id, $.items[*].id, $['key with space'], $.items.length
 * Returns all matches (an empty array when nothing matches).
 */
export function jsonPath(data: unknown, path: string): unknown[] {
  const p = path.trim();
  if (!p.startsWith('$')) throw new Error(`JSONPath must start with $: ${path}`);
  const tokens: (string | number | '*')[] = [];
  const re = /\.([A-Za-z_$][\w$-]*)|\[(\d+)\]|\[\*\]|\.\*|\['([^']*)'\]|\["([^"]*)"\]/gy;
  re.lastIndex = 1;
  while (re.lastIndex < p.length) {
    const start = re.lastIndex;
    const m = re.exec(p);
    if (!m || m.index !== start) throw new Error(`Unsupported JSONPath near "${p.slice(start)}"`);
    if (m[1] !== undefined) tokens.push(m[1]);
    else if (m[2] !== undefined) tokens.push(Number(m[2]));
    else if (m[3] !== undefined) tokens.push(m[3]);
    else if (m[4] !== undefined) tokens.push(m[4]);
    else tokens.push('*');
  }
  let nodes: unknown[] = [data];
  for (const t of tokens) {
    const next: unknown[] = [];
    for (const n of nodes) {
      if (n === null || typeof n !== 'object') {
        if (t === 'length' && typeof n === 'string') next.push(n.length);
        continue;
      }
      if (t === '*') next.push(...(Array.isArray(n) ? n : Object.values(n)));
      else if (t === 'length' && Array.isArray(n)) next.push(n.length);
      else if (typeof t === 'number') {
        if (Array.isArray(n) && t < n.length) next.push(n[t]);
      } else if (Object.prototype.hasOwnProperty.call(n, t))
        next.push((n as Record<string, unknown>)[t]);
    }
    nodes = next;
  }
  return nodes;
}
