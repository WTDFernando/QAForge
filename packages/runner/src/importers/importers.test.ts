import { describe, expect, it } from 'vitest';
import { countRequests, importCollection, ImportError, shellSplitForTest } from './test-exports';

const postman = JSON.stringify({
  info: {
    name: 'Shop API',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [{ key: 'baseUrl', value: 'https://api.shop.test' }],
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] },
  item: [
    {
      name: 'Auth',
      item: [
        {
          name: 'Login',
          request: {
            method: 'POST',
            url: { raw: '{{baseUrl}}/login' },
            header: [
              { key: 'Accept', value: 'application/json' },
              { key: 'X-Old', value: '1', disabled: true },
            ],
            body: { mode: 'raw', raw: '{"email":"a@b.c"}', options: { raw: { language: 'json' } } },
            auth: { type: 'noauth' },
          },
          event: [
            {
              listen: 'test',
              script: { exec: ['pm.test("ok", () => pm.response.to.have.status(200));'] },
            },
          ],
        },
      ],
    },
    { name: 'Search', request: { method: 'GET', url: '{{baseUrl}}/search?q=shoes' } },
    {
      name: 'Form',
      request: {
        method: 'POST',
        url: '{{baseUrl}}/f',
        body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1' }] },
      },
    },
    {
      name: 'GQL',
      request: {
        method: 'POST',
        url: '{{baseUrl}}/graphql',
        body: { mode: 'graphql', graphql: { query: '{ me { id } }' } },
        auth: {
          type: 'apikey',
          apikey: [
            { key: 'key', value: 'X-K' },
            { key: 'value', value: 'v' },
          ],
        },
      },
    },
  ],
});

const bru = `meta {
  name: Create order
  type: http
  seq: 2
}

post {
  url: {{baseUrl}}/orders
  body: json
  auth: bearer
}

headers {
  Accept: application/json
  ~X-Debug: 1
}

auth:bearer {
  token: {{token}}
}

body:json {
  {
    "sku": "ABC",
    "qty": 2
  }
}

assert {
  res.status: eq 201
  res.body.id: isDefined
  res.body.items.length: gt 0
  res.headers.location: contains /orders/
}

vars:post-response {
  orderId: res.body.id
}
`;

const openapi = `openapi: 3.0.3
info: { title: Petstore, version: "1" }
servers: [{ url: https://petstore.test/v1/ }]
components:
  securitySchemes:
    bearer: { type: http, scheme: bearer }
  schemas:
    Pet:
      type: object
      required: [id, name]
      properties:
        id: { type: integer, example: 7 }
        name: { type: string }
        tags: { type: array, items: { type: string, enum: [cat, dog] } }
paths:
  /pets:
    get:
      tags: [pets]
      summary: List pets
      parameters: [{ name: limit, in: query, required: true, schema: { type: integer, default: 20 } }]
      responses:
        "200":
          description: ok
          content: { application/json: { schema: { type: array, items: { $ref: "#/components/schemas/Pet" } } } }
    post:
      tags: [pets]
      operationId: createPet
      requestBody: { content: { application/json: { schema: { $ref: "#/components/schemas/Pet" } } } }
      responses: { "201": { description: created } }
  /pets/{petId}:
    get:
      summary: Get a pet
      security: []
      parameters: [{ name: petId, in: path, required: true, schema: { type: string, format: uuid } }]
      responses: { "200": { description: ok } }
`;

describe('Postman', () => {
  it('imports folders, variables, auth, bodies and status checks', () => {
    const c = importCollection('postman', postman);
    expect(c.name).toBe('Shop API');
    expect(c.variables).toEqual({ baseUrl: 'https://api.shop.test' });
    expect(c.auth).toEqual({ type: 'bearer', token: '{{token}}' });
    expect(countRequests(c)).toBe(4);
    const login = c.folders[0]!.requests[0]!;
    expect(login).toMatchObject({
      name: 'Login',
      method: 'POST',
      url: '{{baseUrl}}/login',
      auth: { type: 'none' },
      body: { type: 'json' },
    });
    expect(login.headers[1]).toMatchObject({ name: 'X-Old', enabled: false });
    expect(login.assertions).toEqual([{ type: 'status', op: 'eq', value: '200' }]);
    expect(c.requests[1]!.body).toEqual({
      type: 'form',
      fields: [{ name: 'a', value: '1', enabled: true }],
    });
    expect(c.requests[2]!.body).toMatchObject({ type: 'graphql', query: '{ me { id } }' });
    expect(c.requests[2]!.auth).toMatchObject({ type: 'apiKey', key: 'X-K', value: 'v' });
  });
  it('explains bad input', () => {
    expect(() => importCollection('postman', '{nope')).toThrow(ImportError);
    expect(() => importCollection('postman', '{"info":{}}')).toThrow(/No requests found/);
  });
});

describe('Bruno', () => {
  it('imports a .bru request with auth, body, assertions and chained variables', () => {
    const r = importCollection('bruno', bru, 'create.bru').requests[0]!;
    expect(r).toMatchObject({
      name: 'Create order',
      method: 'POST',
      url: '{{baseUrl}}/orders',
      auth: { type: 'bearer', token: '{{token}}' },
    });
    expect(r.headers).toEqual([
      { name: 'Accept', value: 'application/json', enabled: true },
      { name: 'X-Debug', value: '1', enabled: false },
    ]);
    expect(JSON.parse((r.body as { content: string }).content)).toEqual({ sku: 'ABC', qty: 2 });
    expect(r.assertions).toEqual([
      { type: 'status', op: 'eq', value: '201' },
      { type: 'jsonPath', path: '$.id', op: 'exists', value: '' },
      { type: 'jsonPath', path: '$.items.length', op: 'gt', value: '0' },
      { type: 'header', name: 'location', op: 'contains', value: '/orders/' },
    ]);
    expect(r.extract).toEqual([{ variable: 'orderId', from: 'jsonPath', path: '$.id' }]);
    expect(() => importCollection('bruno', 'meta {\n name: x\n}\n')).toThrow(/not a Bruno request/);
  });
});

describe('OpenAPI', () => {
  it('creates a request per operation with examples, auth from env secrets and schema assertions', () => {
    const c = importCollection('openapi', openapi);
    expect(c.name).toBe('Petstore');
    expect(c.variables).toMatchObject({
      baseUrl: 'https://petstore.test/v1',
      petId: '00000000-0000-4000-8000-000000000000',
    });
    expect(c.auth).toEqual({ type: 'bearer', token: '{{env.API_TOKEN}}' });
    const [list, create] = c.folders[0]!.requests;
    expect(list).toMatchObject({
      name: 'List pets',
      url: '{{baseUrl}}/pets',
      query: [{ name: 'limit', value: '20', enabled: true }],
    });
    expect(list!.assertions[0]).toEqual({ type: 'status', op: 'eq', value: '200' });
    expect(JSON.parse((list!.assertions[1] as { schema: string }).schema).items.required).toEqual([
      'id',
      'name',
    ]);
    expect(create!.name).toBe('createPet');
    expect(JSON.parse((create!.body as { content: string }).content)).toEqual({
      id: 7,
      name: 'string',
      tags: ['cat'],
    });
    const get = c.requests[0]!;
    expect(get).toMatchObject({ url: '{{baseUrl}}/pets/{{petId}}', auth: { type: 'none' } });
  });
  it('explains unsupported documents', () => {
    expect(() => importCollection('openapi', '{"swagger":"2.0"}')).toThrow(/Swagger 2.0/);
    expect(() => importCollection('openapi', 'openapi: 3.0.0\npaths: {}')).toThrow(/no operations/);
    expect(() => importCollection('openapi', ': : :')).toThrow(ImportError);
  });
});

describe('cURL', () => {
  it('parses a browser "Copy as cURL" command', () => {
    const r = importCollection(
      'curl',
      `curl 'https://api.shop.test/orders?page=2' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer eyJabc' \\
  -H 'content-type: application/json' \\
  --data-raw $'{"sku":"A\\'B"}' \\
  --compressed`,
    ).requests[0]!;
    expect(r).toMatchObject({
      method: 'POST',
      url: 'https://api.shop.test/orders',
      auth: { type: 'bearer', token: 'eyJabc' },
      body: { type: 'json' },
    });
    expect(r.query).toEqual([{ name: 'page', value: '2', enabled: true }]);
    expect(r.headers.map((h) => h.name)).toEqual(['accept']);
  });
  it('handles -X, -u, form data, -G and errors', () => {
    const form = importCollection(
      'curl',
      'curl -X PUT -u admin:pw https://x.test/a -d "a=1&b=two words"',
    ).requests[0]!;
    expect(form).toMatchObject({
      method: 'PUT',
      auth: { type: 'basic', username: 'admin', password: 'pw' },
      body: { type: 'form' },
    });
    const get = importCollection('curl', 'curl -G https://x.test/s -d q=shoes').requests[0]!;
    expect(get).toMatchObject({
      method: 'GET',
      query: [{ name: 'q', value: 'shoes', enabled: true }],
    });
    expect(() => importCollection('curl', 'wget x')).toThrow(/starts with curl/);
    expect(() => importCollection('curl', "curl 'https://x")).toThrow(/unclosed quote/);
    expect(() => importCollection('curl', 'curl -H')).toThrow(/needs a value/);
    expect(shellSplitForTest(`a "b c" 'd e' f\\ g`)).toEqual(['a', 'b c', 'd e', 'f g']);
  });
});
