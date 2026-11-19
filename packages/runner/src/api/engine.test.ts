import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertAllowedUrl,
  createDispatcher,
  executeRequest,
  interpolate,
  isPrivateAddress,
  jsonPath,
  runSequence,
  type ApiRequestSpec,
  type ExecuteContext,
} from '../index';

let server: Server;
let base = '';
let oauthCalls = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (status: number, data: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(data));
      };
      if (url.pathname === '/token') {
        oauthCalls++;
        const p = new URLSearchParams(body);
        return p.get('client_secret') === 's3cret-client'
          ? json(200, { access_token: 'tok-from-oauth', expires_in: 3600 })
          : json(401, { error: 'invalid_client' });
      }
      if (url.pathname === '/login')
        return json(
          200,
          { token: 'abc123', user: { id: 7, roles: ['qa', 'lead'] } },
          { 'x-request-id': 'r-1' },
        );
      if (url.pathname === '/me')
        return req.headers.authorization === 'Bearer abc123'
          ? json(200, { id: 7, name: 'Lee', email: 'lee@example.com' })
          : json(401, { error: 'unauthorized' });
      if (url.pathname === '/echo')
        return json(200, {
          method: req.method,
          query: Object.fromEntries(url.searchParams),
          headers: req.headers,
          body,
        });
      if (url.pathname === '/redirect') {
        res.writeHead(302, { location: '/me' });
        return res.end();
      }
      if (url.pathname === '/slow') return setTimeout(() => json(200, {}), 300);
      if (url.pathname === '/text') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end('hello world');
      }
      json(404, { error: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

const spec = (p: Partial<ApiRequestSpec>): ApiRequestSpec => ({
  name: 'r',
  method: 'GET',
  url: `${base}/echo`,
  headers: [],
  query: [],
  body: { type: 'none' },
  auth: null,
  assertions: [],
  extract: [],
  ...p,
});
const ctx = (p: Partial<ExecuteContext> = {}): ExecuteContext => ({
  scope: { vars: {}, env: {}, secrets: {} },
  allowPrivate: true,
  dispatcher: createDispatcher({ allowPrivate: true, timeoutMs: 5000 }),
  tokenCache: new Map(),
  ...p,
});

describe('variables and JSONPath', () => {
  it('interpolates vars, env, secrets and dynamic values, reporting unknown names', () => {
    const missing = new Set<string>();
    const scope = { vars: { id: '7' }, env: { BASE: 'https://x' }, secrets: { TOKEN: 'shh' } };
    expect(interpolate('{{env.BASE}}/u/{{id}}?t={{env.TOKEN}}&x={{nope}}', scope, missing)).toBe(
      'https://x/u/7?t=shh&x={{nope}}',
    );
    expect([...missing]).toEqual(['nope']);
    expect(interpolate('{{$guid}}', scope)).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number(interpolate('{{$timestamp}}', scope))).toBeGreaterThan(1e9);
  });

  it('evaluates the JSONPath subset', () => {
    const d = { items: [{ id: 1, tags: ['a'] }, { id: 2 }], 'odd key': true, name: 'abc' };
    expect(jsonPath(d, '$.items[1].id')).toEqual([2]);
    expect(jsonPath(d, '$.items[*].id')).toEqual([1, 2]);
    expect(jsonPath(d, '$.items.length')).toEqual([2]);
    expect(jsonPath(d, "$['odd key']")).toEqual([true]);
    expect(jsonPath(d, '$.name.length')).toEqual([3]);
    expect(jsonPath(d, '$.missing.x')).toEqual([]);
    expect(() => jsonPath(d, 'items')).toThrow(/start with \$/);
    expect(() => jsonPath(d, '$..deep')).toThrow(/Unsupported/);
  });
});

describe('executing requests', () => {
  it('builds query, headers, JSON body and asserts on status, JSON, headers and time', async () => {
    const r = await executeRequest(
      spec({
        method: 'POST',
        query: [
          { name: 'page', value: '{{page}}', enabled: true },
          { name: 'off', value: 'x', enabled: false },
        ],
        headers: [{ name: 'X-Trace', value: 't1', enabled: true }],
        body: { type: 'json', content: '{"name":"{{name}}"}' },
        assertions: [
          { type: 'status', op: 'eq', value: '200' },
          { type: 'jsonPath', path: '$.method', op: 'eq', value: 'POST' },
          { type: 'jsonPath', path: '$.query.page', op: 'eq', value: '2' },
          { type: 'jsonPath', path: '$.body', op: 'contains', value: 'Ada' },
          { type: 'header', name: 'content-type', op: 'contains', value: 'json' },
          { type: 'responseTime', lessThanMs: 5000 },
          { type: 'bodyContains', value: 'x-trace' },
          {
            type: 'jsonSchema',
            schema: JSON.stringify({ type: 'object', required: ['method', 'query'] }),
          },
        ],
      }),
      ctx({ scope: { vars: { page: '2', name: 'Ada' }, env: {}, secrets: {} } }),
    );
    expect(r.error).toBeNull();
    expect(r.assertions.filter((a) => !a.passed)).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.exchange.request.url).toContain('page=2');
    expect(r.exchange.request.url).not.toContain('off=');
  });

  it('reports failing assertions with the actual value', async () => {
    const r = await executeRequest(
      spec({
        url: `${base}/missing`,
        assertions: [
          { type: 'status', op: 'eq', value: '200' },
          { type: 'jsonPath', path: '$.error', op: 'eq', value: 'gone' },
          { type: 'jsonSchema', schema: JSON.stringify({ type: 'object', required: ['id'] }) },
          { type: 'responseTime', lessThanMs: 1 },
          { type: 'header', name: 'x-nope', op: 'exists', value: '' },
        ],
      }),
      ctx(),
    );
    expect(r.passed).toBe(false);
    expect(r.status).toBe(404);
    expect(r.assertions.map((a) => a.passed)).toEqual([
      false,
      false,
      false,
      expect.any(Boolean),
      false,
    ]);
    expect(r.assertions[0]!.message).toBe('Status 404, expected eq 200');
    expect(r.assertions[1]!.message).toContain('not found');
    expect(r.assertions[2]!.message).toContain("must have required property 'id'");
  });

  it('chains values between requests and authenticates with a bearer token', async () => {
    const c = ctx();
    const results = await runSequence(
      [
        spec({
          url: `${base}/login`,
          method: 'POST',
          extract: [
            { variable: 'token', from: 'jsonPath', path: '$.token' },
            { variable: 'reqId', from: 'header', path: 'x-request-id' },
            { variable: 'code', from: 'status', path: '' },
          ],
        }),
        spec({
          url: `${base}/me`,
          auth: { type: 'bearer', token: '{{token}}' },
          assertions: [{ type: 'jsonPath', path: '$.name', op: 'eq', value: 'Lee' }],
        }),
      ],
      c,
    );
    expect(results.map((r) => r.passed)).toEqual([true, true]);
    expect(c.scope.vars).toMatchObject({ token: 'abc123', reqId: 'r-1', code: '200' });
  });

  it('supports basic, API key, inherited and OAuth2 client-credentials auth (token cached)', async () => {
    const sent = async (
      collectionAuth: ExecuteContext['collectionAuth'],
      own: ApiRequestSpec['auth'],
      c = ctx(),
    ) => {
      const r = await executeRequest(spec({ auth: own }), { ...c, collectionAuth });
      return JSON.parse(r.exchange.response!.body) as {
        headers: Record<string, string>;
        query: Record<string, string>;
      };
    };
    expect(
      (await sent(undefined, { type: 'basic', username: 'u', password: 'p' })).headers
        .authorization,
    ).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
    expect(
      (await sent({ type: 'apiKey', key: 'X-Key', value: 'k1', in: 'header' }, null)).headers[
        'x-key'
      ],
    ).toBe('k1');
    expect(
      (await sent({ type: 'apiKey', key: 'key', value: 'k2', in: 'query' }, { type: 'inherit' }))
        .query.key,
    ).toBe('k2');
    expect(
      (await sent({ type: 'bearer', token: 't' }, { type: 'none' })).headers.authorization,
    ).toBeUndefined();

    oauthCalls = 0;
    const c = ctx({ scope: { vars: {}, env: {}, secrets: { CLIENT_SECRET: 's3cret-client' } } });
    const oauth = {
      type: 'oauth2' as const,
      grant: 'client_credentials' as const,
      tokenUrl: `${base}/token`,
      clientId: 'qa',
      clientSecret: '{{env.CLIENT_SECRET}}',
      scope: 'read',
    };
    expect((await sent(oauth, null, c)).headers.authorization).toBe('Bearer tok-from-oauth');
    expect((await sent(oauth, null, c)).headers.authorization).toBe('Bearer tok-from-oauth');
    expect(oauthCalls).toBe(1);
    const bad = await executeRequest(spec({ auth: { ...oauth, clientSecret: 'wrong' } }), ctx());
    expect(bad.error).toBe('OAuth2 token request failed (401)');
  });

  it('redacts secrets and credential headers from the stored exchange', async () => {
    const c = ctx({ scope: { vars: {}, env: {}, secrets: { API_KEY: 'super-secret-key-123' } } });
    const r = await executeRequest(
      spec({
        method: 'POST',
        auth: { type: 'apiKey', key: 'X-Api-Key', value: '{{env.API_KEY}}', in: 'header' },
        body: { type: 'json', content: '{"key":"{{env.API_KEY}}"}' },
        query: [{ name: 'k', value: '{{env.API_KEY}}', enabled: true }],
      }),
      c,
    );
    expect(r.passed).toBe(true);
    const stored = JSON.stringify(r.exchange);
    expect(stored).not.toContain('super-secret-key-123');
    expect(r.exchange.request.headers['x-api-key']).toBe('[redacted]');
    expect(r.exchange.request.url).toContain(
      'k=%5Bredacted%5D'.replace('%5Bredacted%5D', '[redacted]'),
    );
  });

  it('handles form, text and GraphQL bodies, redirects, timeouts and unknown variables', async () => {
    const form = await executeRequest(
      spec({
        method: 'POST',
        body: { type: 'form', fields: [{ name: 'a', value: '1 2', enabled: true }] },
      }),
      ctx(),
    );
    expect(JSON.parse(form.exchange.response!.body).body).toBe('a=1+2');
    const gql = await executeRequest(
      spec({
        method: 'POST',
        body: { type: 'graphql', query: '{ me { id } }', variables: '{"x":1}' },
      }),
      ctx(),
    );
    expect(JSON.parse(JSON.parse(gql.exchange.response!.body).body)).toEqual({
      query: '{ me { id } }',
      variables: { x: 1 },
    });
    const text = await executeRequest(
      spec({
        url: `${base}/text`,
        assertions: [{ type: 'jsonPath', path: '$.a', op: 'exists', value: '' }],
      }),
      ctx(),
    );
    expect(text.assertions[0]!.message).toBe('Response is not JSON');
    const redirect = await executeRequest(spec({ url: `${base}/redirect` }), ctx());
    expect(redirect.status).toBe(401);
    const slow = await executeRequest(spec({ url: `${base}/slow` }), ctx({ timeoutMs: 50 }));
    expect(slow.error).toMatch(/Timed out after 50 ms/);
    const unknown = await executeRequest(spec({ url: `${base}/u/{{userId}}` }), ctx());
    expect(unknown.error).toBe('Unknown variable: {{userId}}');
    const noAssert = await executeRequest(spec({ url: `${base}/missing` }), ctx());
    expect(noAssert.passed).toBe(false);
  });
});

describe('SSRF guard', () => {
  it('classifies private, loopback, metadata and public addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      'localhost',
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('blocks literal private IPs and hostnames that resolve to private addresses', async () => {
    expect(() =>
      assertAllowedUrl(new URL('http://169.254.169.254/latest/meta-data'), false),
    ).toThrow(/Blocked/);
    expect(() => assertAllowedUrl(new URL('file:///etc/passwd'), false)).toThrow(
      /Only http and https/,
    );
    expect(() => assertAllowedUrl(new URL('http://127.0.0.1'), true)).not.toThrow();
    const guarded = ctx({
      allowPrivate: false,
      dispatcher: createDispatcher({ allowPrivate: false, timeoutMs: 5000 }),
    });
    const literal = await executeRequest(spec({}), guarded);
    expect(literal.error).toMatch(/Blocked request to 127\.0\.0\.1/);
    const port = new URL(base).port;
    const byName = await executeRequest(spec({ url: `http://localhost:${port}/echo` }), guarded);
    expect(byName.error).toMatch(/Blocked request to localhost/);
  });
});
