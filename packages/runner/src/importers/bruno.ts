import type {
  ApiAuth,
  Assertion,
  CompareOp,
  ExtractRule,
  HttpMethod,
  KeyValue,
} from '@qaforge/shared';
import type { ApiRequestSpec } from '../api/execute';
import { emptyRequest, ImportError } from './types';

/** Split a .bru file into named blocks: `name { ... }` (nested braces in bodies are kept). */
function blocks(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^([a-z][\w:-]*)\s*\{\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
    }
    out.set(m[1]!.toLowerCase(), text.slice(re.lastIndex, i - 1).replace(/^\n|\n\s*$/g, ''));
    re.lastIndex = i;
  }
  return out;
}

function pairs(body = ''): { key: string; value: string; enabled: boolean }[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(':');
      const key = (i === -1 ? l : l.slice(0, i)).trim();
      return {
        key: key.replace(/^~/, ''),
        value: i === -1 ? '' : l.slice(i + 1).trim(),
        enabled: !key.startsWith('~'),
      };
    });
}

const OPS: Record<string, CompareOp> = {
  eq: 'eq',
  neq: 'neq',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  contains: 'contains',
  matches: 'matches',
  isdefined: 'exists',
  isundefined: 'notExists',
  isnull: 'notExists',
};

/** Bruno `res.body.a.b` → JSONPath `$.a.b`. */
const toPath = (expr: string) => `$${expr.replace(/^res\.body/, '').replace(/^(?=[^.[])/, '.')}`;

/** One Bruno request file (.bru). */
export function importBruno(content: string, fileName = ''): ApiRequestSpec {
  const b = blocks(content);
  const methodBlock = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].find((m) =>
    b.has(m),
  );
  if (!methodBlock)
    throw new ImportError(`${fileName || 'This file'} is not a Bruno request (.bru) file.`);
  const meta = Object.fromEntries(pairs(b.get('meta')).map((p) => [p.key, p.value]));
  const req = Object.fromEntries(pairs(b.get(methodBlock)).map((p) => [p.key, p.value]));
  const spec = emptyRequest(
    meta.name || fileName.replace(/\.bru$/, '') || 'Request',
    req.url ?? '',
  );
  spec.method = methodBlock.toUpperCase() as HttpMethod;
  const toKv = (k: string): KeyValue[] =>
    pairs(b.get(k)).map((p) => ({ name: p.key, value: p.value, enabled: p.enabled }));
  spec.headers = toKv('headers');
  spec.query = toKv('params:query');

  const authKind = req.auth ?? '';
  const a = Object.fromEntries(pairs(b.get(`auth:${authKind}`)).map((p) => [p.key, p.value]));
  const auth: ApiAuth | null =
    authKind === 'bearer'
      ? { type: 'bearer', token: a.token ?? '' }
      : authKind === 'basic'
        ? { type: 'basic', username: a.username ?? '', password: a.password ?? '' }
        : authKind === 'apikey'
          ? {
              type: 'apiKey',
              key: a.key ?? 'X-API-Key',
              value: a.value ?? '',
              in: a.placement === 'queryparams' ? 'query' : 'header',
            }
          : authKind === 'none'
            ? { type: 'none' }
            : authKind === 'inherit'
              ? { type: 'inherit' }
              : null;
  spec.auth = auth;

  if (b.has('body:json'))
    spec.body = { type: 'json', content: b.get('body:json')!.replace(/^ {2}/gm, '') };
  else if (b.has('body:text'))
    spec.body = {
      type: 'text',
      content: b.get('body:text')!.replace(/^ {2}/gm, ''),
      contentType: 'text/plain',
    };
  else if (b.has('body:form-urlencoded'))
    spec.body = { type: 'form', fields: toKv('body:form-urlencoded') };
  else if (b.has('body:graphql'))
    spec.body = {
      type: 'graphql',
      query: b.get('body:graphql')!.replace(/^ {2}/gm, ''),
      variables: b.get('body:graphql:vars') ?? '',
    };

  spec.assertions = pairs(b.get('assert')).flatMap((p): Assertion[] => {
    const [opRaw = 'eq', ...rest] = p.value.split(/\s+/);
    const op = OPS[opRaw.toLowerCase()] ?? 'eq';
    const value = (OPS[opRaw.toLowerCase()] ? rest.join(' ') : p.value).replace(/^["']|["']$/g, '');
    if (p.key === 'res.status') return [{ type: 'status', op, value }];
    if (p.key === 'res.responseTime' && (op === 'lt' || op === 'lte'))
      return [{ type: 'responseTime', lessThanMs: Number(value) }];
    if (p.key.startsWith('res.body')) return [{ type: 'jsonPath', path: toPath(p.key), op, value }];
    if (p.key.startsWith('res.headers.'))
      return [{ type: 'header', name: p.key.slice(12), op, value }];
    return [];
  });
  spec.extract = pairs(b.get('vars:post-response')).flatMap((p): ExtractRule[] =>
    p.value.startsWith('res.body')
      ? [{ variable: p.key, from: 'jsonPath', path: toPath(p.value) }]
      : p.value.startsWith('res.headers.')
        ? [{ variable: p.key, from: 'header', path: p.value.slice(12) }]
        : p.value === 'res.status'
          ? [{ variable: p.key, from: 'status', path: '' }]
          : [],
  );
  return spec;
}
