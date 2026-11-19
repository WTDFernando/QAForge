import { Ajv } from 'ajv';
import { fetch, type Dispatcher } from 'undici';
import type {
  ApiAuth,
  ApiBody,
  Assertion,
  CompareOp,
  ExtractRule,
  HttpMethod,
  KeyValue,
} from '@qaforge/shared';
import { jsonPath } from './jsonpath';
import { assertAllowedUrl } from './net-guard';
import { interpolate, redactSecrets, SENSITIVE_HEADERS, type VariableScope } from './variables';

export interface ApiRequestSpec {
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  query: KeyValue[];
  body: ApiBody;
  /** null/inherit = use the collection's auth */
  auth: ApiAuth | null;
  assertions: Assertion[];
  extract: ExtractRule[];
}

export interface ExecuteContext {
  scope: VariableScope;
  collectionAuth?: ApiAuth;
  dispatcher?: Dispatcher;
  allowPrivate?: boolean;
  timeoutMs?: number;
  /** Shared across a run so OAuth2 tokens are fetched once. */
  tokenCache?: Map<string, { token: string; expiresAt: number }>;
}

export interface AssertionOutcome {
  assertion: Assertion;
  passed: boolean;
  actual: string;
  message: string;
}

export interface ApiExecution {
  passed: boolean;
  error: string | null;
  durationMs: number;
  status: number | null;
  assertions: AssertionOutcome[];
  extracted: Record<string, string>;
  missingVariables: string[];
  /** Safe to store and show: secrets and credential headers are redacted, bodies truncated. */
  exchange: {
    request: { method: string; url: string; headers: Record<string, string>; body: string | null };
    response: {
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: string;
      size: number;
      truncated: boolean;
    } | null;
  };
}

const MAX_BODY = 200_000;
const ajv = new Ajv({ allErrors: true, strict: false });

function compare(op: CompareOp, actual: unknown, expected: string): boolean {
  const a = typeof actual === 'string' ? actual : JSON.stringify(actual);
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
  switch (op) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'notExists':
      return actual === undefined || actual === null;
    case 'eq':
      return (
        a === expected ||
        (typeof actual === 'number' && actual === Number(expected)) ||
        String(actual) === expected
      );
    case 'neq':
      return !(a === expected || String(actual) === expected);
    case 'gt':
      return num(actual) > Number(expected);
    case 'gte':
      return num(actual) >= Number(expected);
    case 'lt':
      return num(actual) < Number(expected);
    case 'lte':
      return num(actual) <= Number(expected);
    case 'contains':
      return Array.isArray(actual)
        ? actual.map(String).includes(expected)
        : String(a ?? '').includes(expected);
    case 'matches':
      try {
        return new RegExp(expected).test(String(a ?? ''));
      } catch {
        return false;
      }
    case 'type':
      return (
        (Array.isArray(actual) ? 'array' : actual === null ? 'null' : typeof actual) === expected
      );
  }
}

const show = (v: unknown) =>
  v === undefined
    ? '(missing)'
    : typeof v === 'string'
      ? v
      : (JSON.stringify(v)?.slice(0, 500) ?? String(v));

async function oauthToken(
  auth: Extract<ApiAuth, { type: 'oauth2' }>,
  ctx: ExecuteContext,
  s: (x: string) => string,
): Promise<string> {
  const key = `${s(auth.tokenUrl)}|${s(auth.clientId)}|${s(auth.scope)}`;
  const cached = ctx.tokenCache?.get(key);
  if (cached && cached.expiresAt > Date.now() + 5000) return cached.token;
  const url = new URL(s(auth.tokenUrl));
  assertAllowedUrl(url, !!ctx.allowPrivate);
  const res = await fetch(url, {
    method: 'POST',
    dispatcher: ctx.dispatcher,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: s(auth.clientId),
      client_secret: s(auth.clientSecret),
      ...(auth.scope ? { scope: s(auth.scope) } : {}),
    }).toString(),
    signal: AbortSignal.timeout(ctx.timeoutMs ?? 30_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!res.ok || !data.access_token) throw new Error(`OAuth2 token request failed (${res.status})`);
  ctx.tokenCache?.set(key, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 300) * 1000,
  });
  return data.access_token;
}

/** Execute one request: build it, send it, assert, extract. Never throws for HTTP-level failures. */
export async function executeRequest(
  spec: ApiRequestSpec,
  ctx: ExecuteContext,
): Promise<ApiExecution> {
  const missing = new Set<string>();
  const s = (x: string) => interpolate(x, ctx.scope, missing);
  const secrets = { ...ctx.scope.secrets };
  const redact = (x: string) => redactSecrets(x, secrets);
  const started = performance.now();
  const reqHeaders: Record<string, string> = {};
  let bodyText: string | null = null;
  let finalUrl = s(spec.url);
  const fail = (error: string, extra: Partial<ApiExecution> = {}): ApiExecution => ({
    passed: false,
    error: redact(error),
    durationMs: Math.round(performance.now() - started),
    status: null,
    assertions: [],
    extracted: {},
    missingVariables: [...missing],
    exchange: {
      request: {
        method: spec.method,
        url: redact(finalUrl),
        headers: safeHeaders(reqHeaders, redact),
        body: bodyText ? redact(bodyText.slice(0, MAX_BODY)) : null,
      },
      response: null,
    },
    ...extra,
  });

  try {
    const url = new URL(finalUrl);
    for (const q of spec.query)
      if (q.enabled && q.name) url.searchParams.append(s(q.name), s(q.value));
    for (const h of spec.headers)
      if (h.enabled && h.name) reqHeaders[s(h.name).toLowerCase()] = s(h.value);

    const auth = !spec.auth || spec.auth.type === 'inherit' ? ctx.collectionAuth : spec.auth;
    if (auth && auth.type !== 'none' && auth.type !== 'inherit') {
      if (auth.type === 'bearer') reqHeaders.authorization = `Bearer ${s(auth.token)}`;
      else if (auth.type === 'basic')
        reqHeaders.authorization = `Basic ${Buffer.from(`${s(auth.username)}:${s(auth.password)}`).toString('base64')}`;
      else if (auth.type === 'apiKey') {
        if (auth.in === 'query') url.searchParams.set(s(auth.key), s(auth.value));
        else reqHeaders[s(auth.key).toLowerCase()] = s(auth.value);
      } else if (auth.type === 'oauth2')
        reqHeaders.authorization = `Bearer ${await oauthToken(auth, ctx, s)}`;
    }

    const b = spec.body;
    if (b.type === 'json') {
      bodyText = s(b.content);
      reqHeaders['content-type'] ??= 'application/json';
    } else if (b.type === 'text') {
      bodyText = s(b.content);
      reqHeaders['content-type'] ??= b.contentType;
    } else if (b.type === 'form') {
      bodyText = new URLSearchParams(
        b.fields
          .filter((f) => f.enabled && f.name)
          .map((f): [string, string] => [s(f.name), s(f.value)]),
      ).toString();
      reqHeaders['content-type'] ??= 'application/x-www-form-urlencoded';
    } else if (b.type === 'graphql') {
      const vars = s(b.variables).trim();
      bodyText = JSON.stringify({
        query: s(b.query),
        variables: vars ? JSON.parse(vars) : undefined,
      });
      reqHeaders['content-type'] ??= 'application/json';
    }
    finalUrl = url.toString();
    if (missing.size)
      return fail(
        `Unknown variable${missing.size > 1 ? 's' : ''}: ${[...missing].map((m) => `{{${m}}}`).join(', ')}`,
      );
    assertAllowedUrl(url, !!ctx.allowPrivate);

    const res = await fetch(url, {
      method: spec.method,
      headers: reqHeaders,
      body: spec.method === 'GET' || spec.method === 'HEAD' ? undefined : (bodyText ?? undefined),
      dispatcher: ctx.dispatcher,
      redirect: 'follow',
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 30_000),
    });
    const raw = await res.text();
    const durationMs = Math.round(performance.now() - started);
    let json: unknown;
    let isJson = false;
    try {
      json = JSON.parse(raw);
      isJson = true;
    } catch {
      /* not JSON */
    }
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (resHeaders[k] = v));

    const outcomes = spec.assertions.map((a): AssertionOutcome => {
      try {
        switch (a.type) {
          case 'status': {
            const ok = compare(a.op, res.status, a.value);
            return {
              assertion: a,
              passed: ok,
              actual: String(res.status),
              message: ok ? '' : `Status ${res.status}, expected ${a.op} ${a.value}`,
            };
          }
          case 'header': {
            const v = resHeaders[a.name.toLowerCase()];
            const ok = compare(a.op, v, a.value);
            return {
              assertion: a,
              passed: ok,
              actual: show(v),
              message: ok ? '' : `Header ${a.name} is ${show(v)}`,
            };
          }
          case 'jsonPath': {
            if (!isJson)
              return {
                assertion: a,
                passed: false,
                actual: '(not JSON)',
                message: 'Response is not JSON',
              };
            const matches = jsonPath(json, a.path);
            const v = matches.length > 1 ? matches : matches[0];
            const ok = compare(a.op, v, a.value);
            return {
              assertion: a,
              passed: ok,
              actual: show(v),
              message: ok
                ? ''
                : `${a.path} is ${show(v)}, expected ${a.op}${a.value ? ` ${a.value}` : ''}`,
            };
          }
          case 'jsonSchema': {
            if (!isJson)
              return {
                assertion: a,
                passed: false,
                actual: '(not JSON)',
                message: 'Response is not JSON',
              };
            const validate = ajv.compile(JSON.parse(a.schema) as object);
            const ok = validate(json) as boolean;
            const msg = ok
              ? ''
              : (validate.errors ?? [])
                  .slice(0, 3)
                  .map((e) => `${e.instancePath || '/'} ${e.message}`)
                  .join('; ');
            return { assertion: a, passed: ok, actual: ok ? 'valid' : 'invalid', message: msg };
          }
          case 'responseTime': {
            const ok = durationMs < a.lessThanMs;
            return {
              assertion: a,
              passed: ok,
              actual: `${durationMs} ms`,
              message: ok ? '' : `Took ${durationMs} ms (limit ${a.lessThanMs} ms)`,
            };
          }
          case 'bodyContains': {
            const expected = s(a.value);
            const ok = raw.includes(expected);
            return {
              assertion: a,
              passed: ok,
              actual: ok ? 'found' : 'not found',
              message: ok ? '' : `Body does not contain "${expected}"`,
            };
          }
        }
      } catch (e) {
        return { assertion: a, passed: false, actual: '(error)', message: (e as Error).message };
      }
    });

    const extracted: Record<string, string> = {};
    for (const x of spec.extract) {
      const v =
        x.from === 'status'
          ? res.status
          : x.from === 'header'
            ? resHeaders[x.path.toLowerCase()]
            : isJson
              ? jsonPath(json, x.path)[0]
              : undefined;
      if (v !== undefined) extracted[x.variable] = typeof v === 'string' ? v : JSON.stringify(v);
    }

    return {
      // With no assertions, a 2xx/3xx response counts as a pass.
      passed: outcomes.length ? outcomes.every((o) => o.passed) : res.status < 400,
      error: null,
      durationMs,
      status: res.status,
      assertions: outcomes.map((o) => ({
        ...o,
        assertion: JSON.parse(redact(JSON.stringify(o.assertion))) as Assertion,
        actual: redact(o.actual),
        message: redact(o.message),
      })),
      extracted,
      missingVariables: [],
      exchange: {
        request: {
          method: spec.method,
          url: redact(finalUrl),
          headers: safeHeaders(reqHeaders, redact),
          body: bodyText ? redact(bodyText.slice(0, MAX_BODY)) : null,
        },
        response: {
          status: res.status,
          statusText: res.statusText,
          headers: safeHeaders(resHeaders, redact),
          body: redact(raw.slice(0, MAX_BODY)),
          size: Buffer.byteLength(raw),
          truncated: raw.length > MAX_BODY,
        },
      },
    };
  } catch (e) {
    const err = e as Error & { cause?: Error };
    const msg =
      err.name === 'TimeoutError'
        ? `Timed out after ${ctx.timeoutMs ?? 30_000} ms`
        : (err.cause?.message ?? err.message);
    return fail(msg);
  }
}

function safeHeaders(h: Record<string, string>, redact: (s: string) => string) {
  return Object.fromEntries(
    Object.entries(h).map(([k, v]) => [
      k,
      SENSITIVE_HEADERS.has(k.toLowerCase()) ? '[redacted]' : redact(v),
    ]),
  );
}

/** Run requests in order; values extracted by one request are available to the next. */
export async function runSequence(
  specs: ApiRequestSpec[],
  ctx: ExecuteContext,
  onResult?: (spec: ApiRequestSpec, result: ApiExecution, index: number) => Promise<void> | void,
) {
  const results: ApiExecution[] = [];
  for (const [i, spec] of specs.entries()) {
    const r = await executeRequest(spec, ctx);
    Object.assign(ctx.scope.vars, r.extracted);
    results.push(r);
    await onResult?.(spec, r, i);
  }
  return results;
}
