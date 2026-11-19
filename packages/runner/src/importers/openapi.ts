import { parse as parseYaml } from 'yaml';
import type { ApiAuth, Assertion, HttpMethod } from '@qaforge/shared';
import type { ApiRequestSpec } from '../api/execute';
import { emptyRequest, ImportError, type ImportedFolder } from './types';

type Obj = Record<string, unknown>;
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

/** Inline local $refs (#/components/...), guarding against cycles. */
function deref(doc: Obj, node: unknown, seen = new Set<string>()): unknown {
  if (Array.isArray(node)) return node.map((n) => deref(doc, n, seen));
  if (!node || typeof node !== 'object') return node;
  const ref = (node as Obj).$ref;
  if (typeof ref === 'string') {
    if (!ref.startsWith('#/') || seen.has(ref)) return {};
    const target = ref
      .slice(2)
      .split('/')
      .reduce<unknown>(
        (o, k) => (o as Obj | undefined)?.[k.replace(/~1/g, '/').replace(/~0/g, '~')],
        doc,
      );
    return deref(doc, target, new Set([...seen, ref]));
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, deref(doc, v, seen)]));
}

/** A small example value from a JSON schema (uses example/default/enum when present). */
export function exampleOf(schema: Obj | undefined, depth = 0): unknown {
  if (!schema || depth > 6) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const all =
    (schema.allOf as Obj[] | undefined) ??
    (schema.oneOf as Obj[] | undefined)?.slice(0, 1) ??
    (schema.anyOf as Obj[] | undefined)?.slice(0, 1);
  if (all) return Object.assign({}, ...all.map((s) => exampleOf(s, depth + 1) as object));
  switch (schema.type) {
    case 'object':
    case undefined:
      if (!schema.properties) return schema.type === 'object' ? {} : null;
      return Object.fromEntries(
        Object.entries(schema.properties as Record<string, Obj>).map(([k, v]) => [
          k,
          exampleOf(v, depth + 1),
        ]),
      );
    case 'array':
      return [exampleOf(schema.items as Obj, depth + 1)];
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return true;
    default:
      return schema.format === 'email'
        ? 'user@example.com'
        : schema.format === 'uuid'
          ? '00000000-0000-4000-8000-000000000000'
          : schema.format === 'date-time'
            ? new Date(0).toISOString()
            : 'string';
  }
}

/** OpenAPI 3.x (JSON or YAML): one request per operation, grouped by its first tag. */
export function importOpenApi(content: string): ImportedFolder {
  let raw: Obj;
  try {
    raw = (content.trim().startsWith('{') ? JSON.parse(content) : parseYaml(content)) as Obj;
  } catch {
    throw new ImportError('This is not valid JSON or YAML.');
  }
  if (!raw || typeof raw !== 'object' || !String(raw.openapi ?? '').startsWith('3'))
    throw new ImportError(
      raw?.swagger
        ? 'Swagger 2.0 is not supported yet. Convert it to OpenAPI 3 first.'
        : 'This is not an OpenAPI 3 document.',
    );
  const doc = raw;
  const info = (doc.info ?? {}) as Obj;
  const servers = (doc.servers as Obj[] | undefined) ?? [];
  const variables: Record<string, string> = {
    baseUrl: String(servers[0]?.url ?? 'https://api.example.com').replace(/\/$/, ''),
  };

  // Security scheme → collection auth with secrets taken from the environment.
  const schemes = ((doc.components as Obj | undefined)?.securitySchemes ?? {}) as Record<
    string,
    Obj
  >;
  const first = Object.values(schemes)[0];
  const auth: ApiAuth =
    first?.type === 'http' && first.scheme === 'bearer'
      ? { type: 'bearer', token: '{{env.API_TOKEN}}' }
      : first?.type === 'http' && first.scheme === 'basic'
        ? { type: 'basic', username: '{{env.API_USER}}', password: '{{env.API_PASSWORD}}' }
        : first?.type === 'apiKey'
          ? {
              type: 'apiKey',
              key: String(first.name ?? 'X-API-Key'),
              value: '{{env.API_KEY}}',
              in: first.in === 'query' ? 'query' : 'header',
            }
          : first?.type === 'oauth2'
            ? {
                type: 'oauth2',
                grant: 'client_credentials',
                tokenUrl: String(
                  ((first.flows as Obj | undefined)?.clientCredentials as Obj | undefined)
                    ?.tokenUrl ?? '',
                ),
                clientId: '{{env.CLIENT_ID}}',
                clientSecret: '{{env.CLIENT_SECRET}}',
                scope: '',
              }
            : { type: 'none' };

  const root: ImportedFolder = {
    name: String(info.title ?? 'OpenAPI'),
    variables,
    auth,
    requests: [],
    folders: [],
  };
  const byTag = new Map<string, ImportedFolder>();
  for (const [path, item] of Object.entries((doc.paths ?? {}) as Record<string, Obj>)) {
    for (const method of METHODS) {
      const op = deref(doc, item[method]) as Obj | undefined;
      if (!op) continue;
      const params = [
        ...((deref(doc, item.parameters) as Obj[]) ?? []),
        ...((op.parameters as Obj[]) ?? []),
      ];
      const url = `{{baseUrl}}${path.replace(/\{([^}]+)\}/g, (_, p: string) => {
        const prm = params.find((x) => x.in === 'path' && x.name === p);
        root.variables[p] ??= String(exampleOf((prm?.schema as Obj) ?? {}) ?? '');
        return `{{${p}}}`;
      })}`;
      const spec: ApiRequestSpec = emptyRequest(
        String(op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`),
        url,
      );
      spec.method = method.toUpperCase() as HttpMethod;
      spec.query = params
        .filter((x) => x.in === 'query' && x.required)
        .map((x) => ({
          name: String(x.name),
          value: String(exampleOf(x.schema as Obj) ?? ''),
          enabled: true,
        }));
      spec.headers = params
        .filter((x) => x.in === 'header' && x.required)
        .map((x) => ({
          name: String(x.name),
          value: String(exampleOf(x.schema as Obj) ?? ''),
          enabled: true,
        }));
      const json = (
        (op.requestBody as Obj | undefined)?.content as Record<string, Obj> | undefined
      )?.['application/json'];
      if (json)
        spec.body = {
          type: 'json',
          content: JSON.stringify(json.example ?? exampleOf(json.schema as Obj), null, 2),
        };
      if (Array.isArray(op.security) && op.security.length === 0) spec.auth = { type: 'none' };
      const responses = (op.responses ?? {}) as Record<string, Obj>;
      const ok = Object.keys(responses).find((c) => /^2\d\d$/.test(c));
      if (ok) {
        const assertions: Assertion[] = [{ type: 'status', op: 'eq', value: ok }];
        const schema = (responses[ok]!.content as Record<string, Obj> | undefined)?.[
          'application/json'
        ]?.schema;
        if (schema && Object.keys(schema).length)
          assertions.push({ type: 'jsonSchema', schema: JSON.stringify(schema) });
        spec.assertions = assertions;
      }
      const tag = Array.isArray(op.tags) && op.tags.length ? String(op.tags[0]) : null;
      if (!tag) root.requests.push(spec);
      else {
        if (!byTag.has(tag)) {
          const f: ImportedFolder = {
            name: tag,
            variables: {},
            auth: { type: 'inherit' },
            requests: [],
            folders: [],
          };
          byTag.set(tag, f);
          root.folders.push(f);
        }
        byTag.get(tag)!.requests.push(spec);
      }
    }
  }
  if (!root.requests.length && !root.folders.length)
    throw new ImportError('The document has no operations under "paths".');
  return root;
}
