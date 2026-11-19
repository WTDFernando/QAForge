import type { ApiAuth, Assertion, HttpMethod, KeyValue } from '@qaforge/shared';
import { HTTP_METHODS } from '@qaforge/shared';
import type { ApiRequestSpec } from '../api/execute';
import { emptyRequest, ImportError, type ImportedFolder } from './types';

interface PmKV {
  key?: string;
  value?: unknown;
  disabled?: boolean;
  type?: string;
}
interface PmAuth {
  type?: string;
  [k: string]: unknown;
}
interface PmItem {
  name?: string;
  item?: PmItem[];
  request?:
    | {
        method?: string;
        header?: PmKV[];
        url?: string | { raw?: string };
        body?: {
          mode?: string;
          raw?: string;
          urlencoded?: PmKV[];
          formdata?: PmKV[];
          graphql?: { query?: string; variables?: string };
          options?: { raw?: { language?: string } };
        };
        auth?: PmAuth;
      }
    | string;
  event?: { listen?: string; script?: { exec?: string[] | string } }[];
  auth?: PmAuth;
  variable?: PmKV[];
}

const kv = (list: PmKV[] = []): KeyValue[] =>
  list
    .filter((h) => h.key)
    .map((h) => ({ name: h.key!, value: String(h.value ?? ''), enabled: !h.disabled }));

function authOf(a?: PmAuth): ApiAuth | null {
  if (!a?.type) return null;
  const get = (k: string) => {
    const list = a[a.type!] as PmKV[] | undefined;
    return String(list?.find((x) => x.key === k)?.value ?? '');
  };
  switch (a.type) {
    case 'noauth':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', token: get('token') };
    case 'basic':
      return { type: 'basic', username: get('username'), password: get('password') };
    case 'apikey':
      return {
        type: 'apiKey',
        key: get('key') || 'X-API-Key',
        value: get('value'),
        in: get('in') === 'query' ? 'query' : 'header',
      };
    case 'oauth2':
      return {
        type: 'oauth2',
        grant: 'client_credentials',
        tokenUrl: get('accessTokenUrl'),
        clientId: get('clientId'),
        clientSecret: get('clientSecret'),
        scope: get('scope'),
      };
    default:
      return null;
  }
}

/** Status checks from test scripts (pm.response.to.have.status(200), pm.response.code === 201). */
function assertionsFrom(events: PmItem['event'] = []): Assertion[] {
  const code = events
    .filter((e) => e.listen === 'test')
    .flatMap((e) => (Array.isArray(e.script?.exec) ? e.script!.exec : [e.script?.exec ?? '']))
    .join('\n');
  const out: Assertion[] = [];
  for (const m of code.matchAll(
    /pm\.response\.to\.have\.status\((\d{3})\)|pm\.response\.code\)?\s*(?:===|==|\.to\.eql\(|\.to\.equal\()\s*(\d{3})/g,
  ))
    out.push({ type: 'status', op: 'eq', value: m[1] ?? m[2]! });
  return out;
}

function toRequest(item: PmItem): ApiRequestSpec {
  const r = typeof item.request === 'string' ? { url: item.request } : (item.request ?? {});
  const url = typeof r.url === 'string' ? r.url : (r.url?.raw ?? '');
  const method = (r.method ?? 'GET').toUpperCase() as HttpMethod;
  const spec = emptyRequest(item.name ?? (url || 'Request'), url);
  spec.method = (HTTP_METHODS as readonly string[]).includes(method) ? method : 'GET';
  spec.headers = kv(r.header);
  spec.auth = authOf(r.auth);
  const b = r.body;
  if (b?.mode === 'raw' && b.raw) {
    const json = b.options?.raw?.language === 'json' || /^\s*[[{]/.test(b.raw);
    spec.body = json
      ? { type: 'json', content: b.raw }
      : { type: 'text', content: b.raw, contentType: 'text/plain' };
  } else if (b?.mode === 'urlencoded') spec.body = { type: 'form', fields: kv(b.urlencoded) };
  else if (b?.mode === 'graphql')
    spec.body = {
      type: 'graphql',
      query: b.graphql?.query ?? '',
      variables: b.graphql?.variables ?? '',
    };
  else if (b?.mode === 'formdata')
    spec.body = { type: 'form', fields: kv(b.formdata?.filter((f) => f.type !== 'file')) };
  spec.assertions = assertionsFrom(item.event);
  return spec;
}

function folder(
  name: string,
  items: PmItem[],
  auth: ApiAuth,
  variables: Record<string, string>,
): ImportedFolder {
  const f: ImportedFolder = { name, variables, auth, requests: [], folders: [] };
  for (const it of items) {
    if (it.item)
      f.folders.push(
        folder(it.name ?? 'Folder', it.item, authOf(it.auth) ?? { type: 'inherit' }, {}),
      );
    else f.requests.push(toRequest(it));
  }
  return f;
}

/** Postman Collection v2.0/v2.1 JSON. */
export function importPostman(content: string): ImportedFolder {
  let doc: {
    info?: { name?: string; schema?: string };
    item?: PmItem[];
    variable?: PmKV[];
    auth?: PmAuth;
  };
  try {
    doc = JSON.parse(content);
  } catch {
    throw new ImportError(
      'This is not valid JSON. Export the collection from Postman as Collection v2.1.',
    );
  }
  if (!Array.isArray(doc.item))
    throw new ImportError(
      'No requests found. Export the collection from Postman as Collection v2.1.',
    );
  const vars = Object.fromEntries(
    (doc.variable ?? []).filter((v) => v.key).map((v) => [v.key!, String(v.value ?? '')]),
  );
  return folder(
    doc.info?.name ?? 'Postman collection',
    doc.item,
    authOf(doc.auth) ?? { type: 'none' },
    vars,
  );
}
