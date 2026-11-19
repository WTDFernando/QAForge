import type { HttpMethod, KeyValue } from '@qaforge/shared';
import type { ApiRequestSpec } from '../api/execute';
import { emptyRequest, ImportError } from './types';

/** POSIX-ish shell tokenizer: single/double quotes, backslash escapes, line continuations. */
export function shellSplit(input: string): string[] {
  const src = input.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | '$' | null = null;
  const ANSI: Record<string, string> = {
    n: '\n',
    t: '\t',
    r: '\r',
    '\\': '\\',
    "'": "'",
    '"': '"',
  };
  let has = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quote === '$') {
      // ANSI-C quoting $'...' (Chrome "Copy as cURL"): backslash escapes are interpreted.
      if (c === "'") quote = null;
      else if (c === '\\' && i + 1 < src.length) {
        const n = src[++i]!;
        cur += ANSI[n] ?? `\\${n}`;
      } else cur += c;
    } else if (quote === "'") {
      if (c === "'") quote = null;
      else cur += c;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '\\' && i + 1 < src.length && '"\\$`'.includes(src[i + 1]!)) cur += src[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === '\\' && i + 1 < src.length) {
      cur += src[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
    } else if (c === '$' && src[i + 1] === "'") {
      i++;
      quote = '$';
      has = true;
    } else cur += c;
  }
  if (quote) throw new ImportError('The command has an unclosed quote.');
  if (cur || has) out.push(cur);
  return out;
}

const IGNORED = new Set([
  '-s',
  '--silent',
  '-k',
  '--insecure',
  '-L',
  '--location',
  '-i',
  '--include',
  '-v',
  '--verbose',
  '--compressed',
  '-S',
  '--show-error',
  '-f',
  '--fail',
]);

/** A single curl command (e.g. "Copy as cURL" from browser dev tools). */
export function importCurl(content: string): ApiRequestSpec {
  const args = shellSplit(content.trim());
  if (args[0] !== 'curl') throw new ImportError('Paste a command that starts with curl.');
  let method: string | null = null;
  let url = '';
  const headers: KeyValue[] = [];
  const data: string[] = [];
  let getMode = false;
  let user: string | null = null;
  let json = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    const next = () => {
      if (i + 1 >= args.length) throw new ImportError(`${a} needs a value.`);
      return args[++i]!;
    };
    if (a === '-X' || a === '--request') method = next().toUpperCase();
    else if (a === '-H' || a === '--header') {
      const h = next();
      const c = h.indexOf(':');
      if (c > 0)
        headers.push({ name: h.slice(0, c).trim(), value: h.slice(c + 1).trim(), enabled: true });
    } else if (
      ['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode'].includes(
        a,
      )
    )
      data.push(next());
    else if (a === '--json') {
      data.push(next());
      json = true;
    } else if (a === '-u' || a === '--user') user = next();
    else if (a === '-A' || a === '--user-agent')
      headers.push({ name: 'User-Agent', value: next(), enabled: true });
    else if (a === '-b' || a === '--cookie')
      headers.push({ name: 'Cookie', value: next(), enabled: true });
    else if (a === '-e' || a === '--referer')
      headers.push({ name: 'Referer', value: next(), enabled: true });
    else if (a === '--url') url = next();
    else if (a === '-G' || a === '--get') getMode = true;
    else if (IGNORED.has(a)) continue;
    else if (a.startsWith('-')) continue;
    else if (!url) url = a;
  }
  if (!url) throw new ImportError('No URL found in the command.');
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    throw new ImportError(`"${url}" is not a valid URL.`);
  }
  const spec = emptyRequest(
    `${method ?? (data.length && !getMode ? 'POST' : 'GET')} ${parsed.pathname}`,
    '',
  );
  const query: KeyValue[] = [...parsed.searchParams].map(([name, value]) => ({
    name,
    value,
    enabled: true,
  }));
  parsed.search = '';
  spec.url = parsed.toString();
  spec.method = (method ?? (data.length && !getMode ? 'POST' : 'GET')) as HttpMethod;
  if (getMode)
    for (const d of data)
      for (const [name, value] of new URLSearchParams(d))
        query.push({ name, value, enabled: true });
  spec.query = query;
  if (user) {
    const c = user.indexOf(':');
    spec.auth = {
      type: 'basic',
      username: c === -1 ? user : user.slice(0, c),
      password: c === -1 ? '' : user.slice(c + 1),
    };
  }
  const ctIdx = headers.findIndex((h) => h.name.toLowerCase() === 'content-type');
  const ct = ctIdx === -1 ? '' : headers[ctIdx]!.value.toLowerCase();
  // Bearer tokens become auth (so they can be swapped for {{env.TOKEN}}).
  const authIdx = headers.findIndex(
    (h) => h.name.toLowerCase() === 'authorization' && /^bearer\s+/i.test(h.value),
  );
  if (authIdx !== -1 && !user) {
    spec.auth = { type: 'bearer', token: headers[authIdx]!.value.replace(/^bearer\s+/i, '') };
    headers.splice(authIdx, 1);
  }
  if (data.length && !getMode) {
    const body = data.join('&');
    if (json || ct.includes('json') || /^\s*[[{]/.test(body))
      spec.body = { type: 'json', content: body };
    else if (!ct || ct.includes('x-www-form-urlencoded'))
      spec.body = {
        type: 'form',
        fields: [...new URLSearchParams(body)].map(([name, value]) => ({
          name,
          value,
          enabled: true,
        })),
      };
    else spec.body = { type: 'text', content: body, contentType: ct };
    // The body type sets Content-Type itself.
    if (spec.body.type !== 'text') {
      const i = headers.findIndex((h) => h.name.toLowerCase() === 'content-type');
      if (i !== -1) headers.splice(i, 1);
    }
  }
  spec.headers = headers;
  return spec;
}
