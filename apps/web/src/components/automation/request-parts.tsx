'use client';
import { useState } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import {
  COMPARE_OPS,
  type ApiAuth,
  type ApiBody,
  type Assertion,
  type CompareOp,
  type ExtractRule,
  type KeyValue,
} from '@qaforge/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ApiExecution, AssertionOutcome } from '@/hooks/automation';
import { cn } from '@/lib/utils';
import { formatMs } from './shell';

const cell =
  'h-8 w-full rounded-none border-0 bg-transparent px-2 font-mono text-[12.5px] shadow-none focus-visible:ring-1';

/** Editable name/value rows (params, headers, form fields) with an always-empty last row. */
export function KeyValueTable({
  rows,
  onChange,
  label,
  readOnly,
  namePlaceholder = 'Name',
}: {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  label: string;
  readOnly?: boolean;
  namePlaceholder?: string;
}) {
  const all = readOnly ? rows : [...rows, { name: '', value: '', enabled: true }];
  const set = (i: number, patch: Partial<KeyValue>) => {
    const next = all.map((r, j) => (j === i ? { ...r, ...patch } : r));
    onChange(next.filter((r, j) => j < next.length - 1 || r.name || r.value));
  };
  return (
    <div role="table" aria-label={label} className="overflow-hidden rounded-lg border">
      <div
        role="row"
        className="grid grid-cols-[32px_1fr_1.4fr_32px] border-b bg-muted/60 text-[11px] font-semibold text-muted-foreground"
      >
        <span role="columnheader" className="sr-only">
          Enabled
        </span>
        <span />
        <span role="columnheader" className="px-2 py-1.5">
          {namePlaceholder}
        </span>
        <span role="columnheader" className="px-2 py-1.5">
          Value
        </span>
        <span />
      </div>
      {all.map((r, i) => {
        const draft = !readOnly && i === all.length - 1;
        return (
          <div
            role="row"
            key={i}
            className="grid grid-cols-[32px_1fr_1.4fr_32px] items-center border-b last:border-b-0"
          >
            <span role="cell" className="flex justify-center">
              {!draft && (
                <Checkbox
                  checked={r.enabled}
                  disabled={readOnly}
                  aria-label={`Enable ${r.name || 'row'}`}
                  onCheckedChange={(v) => set(i, { enabled: v === true })}
                />
              )}
            </span>
            <span role="cell" className="border-l">
              <Input
                value={r.name}
                readOnly={readOnly}
                placeholder={draft ? `Add ${namePlaceholder.toLowerCase()}` : ''}
                aria-label={`${label} ${i + 1} name`}
                onChange={(e) => set(i, { name: e.target.value })}
                className={cn(cell, !r.enabled && 'text-muted-foreground line-through')}
              />
            </span>
            <span role="cell" className="border-l">
              <Input
                value={r.value}
                readOnly={readOnly}
                placeholder={draft ? 'Value or {{variable}}' : ''}
                aria-label={`${label} ${i + 1} value`}
                onChange={(e) => set(i, { value: e.target.value })}
                className={cell}
              />
            </span>
            <span role="cell" className="flex justify-center">
              {!draft && !readOnly && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  aria-label={`Remove ${r.name || 'row'}`}
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function BodyEditor({
  body,
  onChange,
  readOnly,
}: {
  body: ApiBody;
  onChange: (b: ApiBody) => void;
  readOnly?: boolean;
}) {
  const types: [ApiBody['type'], string][] = [
    ['none', 'None'],
    ['json', 'JSON'],
    ['text', 'Text'],
    ['form', 'Form'],
    ['graphql', 'GraphQL'],
  ];
  const switchTo = (t: ApiBody['type']) => {
    const content = 'content' in body ? body.content : '';
    onChange(
      t === 'none'
        ? { type: 'none' }
        : t === 'json'
          ? { type: 'json', content }
          : t === 'text'
            ? { type: 'text', content, contentType: 'text/plain' }
            : t === 'form'
              ? { type: 'form', fields: [] }
              : { type: 'graphql', query: '', variables: '' },
    );
  };
  const area =
    'min-h-40 w-full rounded-lg border bg-card p-3 font-mono text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label="Body type" className="flex flex-wrap gap-1">
        {types.map(([t, l]) => (
          <button
            key={t}
            role="radio"
            aria-checked={body.type === t}
            disabled={readOnly}
            onClick={() => switchTo(t)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium',
              body.type === t
                ? 'bg-primary-subtle text-primary'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {l}
          </button>
        ))}
      </div>
      {body.type === 'none' && (
        <p className="text-sm text-muted-foreground">This request has no body.</p>
      )}
      {(body.type === 'json' || body.type === 'text') && (
        <textarea
          aria-label="Request body"
          readOnly={readOnly}
          spellCheck={false}
          value={body.content}
          onChange={(e) => onChange({ ...body, content: e.target.value })}
          placeholder={body.type === 'json' ? '{ "title": "{{title}}" }' : ''}
          className={area}
        />
      )}
      {body.type === 'form' && (
        <KeyValueTable
          label="Form fields"
          rows={body.fields}
          readOnly={readOnly}
          onChange={(fields) => onChange({ type: 'form', fields })}
        />
      )}
      {body.type === 'graphql' && (
        <div className="grid gap-2 md:grid-cols-[2fr_1fr]">
          <textarea
            aria-label="GraphQL query"
            readOnly={readOnly}
            spellCheck={false}
            value={body.query}
            onChange={(e) => onChange({ ...body, query: e.target.value })}
            className={area}
          />
          <textarea
            aria-label="GraphQL variables"
            readOnly={readOnly}
            spellCheck={false}
            value={body.variables}
            placeholder="{ }"
            onChange={(e) => onChange({ ...body, variables: e.target.value })}
            className={area}
          />
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

/** Auth helpers. Secrets are references ({{env.NAME}}); the editor warns about pasted literals. */
export function AuthEditor({
  auth,
  onChange,
  allowInherit,
  readOnly,
}: {
  auth: ApiAuth;
  onChange: (a: ApiAuth) => void;
  allowInherit: boolean;
  readOnly?: boolean;
}) {
  const types: [ApiAuth['type'], string][] = [
    ...(allowInherit
      ? ([['inherit', 'Inherit from collection']] as [ApiAuth['type'], string][])
      : []),
    ['none', 'No auth'],
    ['bearer', 'Bearer token'],
    ['basic', 'Basic auth'],
    ['apiKey', 'API key'],
    ['oauth2', 'OAuth 2.0 (client credentials)'],
  ];
  const set = (t: ApiAuth['type']) =>
    onChange(
      t === 'bearer'
        ? { type: 'bearer', token: '{{env.API_TOKEN}}' }
        : t === 'basic'
          ? { type: 'basic', username: '', password: '{{env.API_PASSWORD}}' }
          : t === 'apiKey'
            ? { type: 'apiKey', key: 'X-API-Key', value: '{{env.API_KEY}}', in: 'header' }
            : t === 'oauth2'
              ? {
                  type: 'oauth2',
                  grant: 'client_credentials',
                  tokenUrl: '',
                  clientId: '',
                  clientSecret: '{{env.CLIENT_SECRET}}',
                  scope: '',
                }
              : { type: t },
    );
  const input = (value: string, on: (v: string) => void, label: string, secret = false) => (
    <Field label={label}>
      <Input
        value={value}
        readOnly={readOnly}
        onChange={(e) => on(e.target.value)}
        className="font-mono text-[12.5px]"
        aria-invalid={secret && !!value && !value.includes('{{') ? true : undefined}
      />
      {secret && !!value && !value.includes('{{') && (
        <span className="text-[11px] font-normal text-warning-text">
          Store this in an environment secret and reference it as {'{{env.NAME}}'}.
        </span>
      )}
    </Field>
  );
  return (
    <div className="grid max-w-xl gap-3">
      <Field label="Type">
        <Select
          value={auth.type}
          onValueChange={(v) => set(v as ApiAuth['type'])}
          disabled={readOnly}
        >
          <SelectTrigger aria-label="Auth type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {types.map(([t, l]) => (
              <SelectItem key={t} value={t}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {auth.type === 'inherit' && (
        <p className="text-sm text-muted-foreground">Uses the auth set on the collection.</p>
      )}
      {auth.type === 'bearer' &&
        input(auth.token, (token) => onChange({ ...auth, token }), 'Token', true)}
      {auth.type === 'basic' && (
        <>
          {input(auth.username, (username) => onChange({ ...auth, username }), 'Username')}
          {input(auth.password, (password) => onChange({ ...auth, password }), 'Password', true)}
        </>
      )}
      {auth.type === 'apiKey' && (
        <>
          {input(auth.key, (key) => onChange({ ...auth, key }), 'Key name')}
          {input(auth.value, (value) => onChange({ ...auth, value }), 'Value', true)}
          <Field label="Send in">
            <Select
              value={auth.in}
              onValueChange={(v) => onChange({ ...auth, in: v as 'header' | 'query' })}
              disabled={readOnly}
            >
              <SelectTrigger aria-label="Send API key in" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="header">Header</SelectItem>
                <SelectItem value="query">Query parameter</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </>
      )}
      {auth.type === 'oauth2' && (
        <>
          {input(auth.tokenUrl, (tokenUrl) => onChange({ ...auth, tokenUrl }), 'Token URL')}
          {input(auth.clientId, (clientId) => onChange({ ...auth, clientId }), 'Client ID')}
          {input(
            auth.clientSecret,
            (clientSecret) => onChange({ ...auth, clientSecret }),
            'Client secret',
            true,
          )}
          {input(auth.scope, (scope) => onChange({ ...auth, scope }), 'Scope')}
        </>
      )}
    </div>
  );
}

const OP_LABEL: Record<CompareOp, string> = {
  eq: 'equals',
  neq: 'not equals',
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
  contains: 'contains',
  exists: 'exists',
  notExists: 'does not exist',
  matches: 'matches regex',
  type: 'is of type',
};

const ASSERTION_TYPES: [Assertion['type'], string][] = [
  ['status', 'Status'],
  ['header', 'Header'],
  ['jsonPath', 'JSON path'],
  ['jsonSchema', 'JSON schema'],
  ['responseTime', 'Response time'],
  ['bodyContains', 'Body contains'],
];

function newAssertion(t: Assertion['type']): Assertion {
  switch (t) {
    case 'status':
      return { type: 'status', op: 'eq', value: '200' };
    case 'header':
      return { type: 'header', name: 'content-type', op: 'contains', value: 'json' };
    case 'jsonPath':
      return { type: 'jsonPath', path: '$.', op: 'exists', value: '' };
    case 'jsonSchema':
      return { type: 'jsonSchema', schema: '{ "type": "object" }' };
    case 'responseTime':
      return { type: 'responseTime', lessThanMs: 1000 };
    case 'bodyContains':
      return { type: 'bodyContains', value: '' };
  }
}

export function AssertionsEditor({
  assertions,
  onChange,
  outcomes,
  readOnly,
}: {
  assertions: Assertion[];
  onChange: (a: Assertion[]) => void;
  /** From the last send, matched by index */
  outcomes?: AssertionOutcome[];
  readOnly?: boolean;
}) {
  const set = (i: number, a: Assertion) => onChange(assertions.map((x, j) => (j === i ? a : x)));
  const opSelect = (a: Extract<Assertion, { op: CompareOp }>, i: number) => (
    <Select
      value={a.op}
      onValueChange={(op) => set(i, { ...a, op: op as CompareOp })}
      disabled={readOnly}
    >
      <SelectTrigger aria-label={`Assertion ${i + 1} operator`} className="h-8 w-36 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {COMPARE_OPS.map((o) => (
          <SelectItem key={o} value={o}>
            {OP_LABEL[o]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const text = (value: string, on: (v: string) => void, label: string, className = '') => (
    <Input
      value={value}
      readOnly={readOnly}
      aria-label={label}
      onChange={(e) => on(e.target.value)}
      className={cn('h-8 font-mono text-[12.5px]', className)}
    />
  );
  return (
    <div className="grid gap-2">
      {assertions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No assertions yet. A request without assertions only fails on network errors.
        </p>
      )}
      <ul className="grid gap-2" aria-label="Assertions">
        {assertions.map((a, i) => {
          const out = outcomes?.[i];
          return (
            <li
              key={i}
              className={cn(
                'flex flex-wrap items-center gap-2 rounded-lg border p-2',
                out && !out.passed && 'border-destructive/40 bg-destructive-subtle/40',
              )}
            >
              <span className="w-28 text-xs font-semibold">
                {ASSERTION_TYPES.find(([t]) => t === a.type)![1]}
              </span>
              {a.type === 'status' && (
                <>
                  {opSelect(a, i)}
                  {text(
                    a.value,
                    (value) => set(i, { ...a, value }),
                    `Assertion ${i + 1} expected status`,
                    'w-24',
                  )}
                </>
              )}
              {a.type === 'header' && (
                <>
                  {text(
                    a.name,
                    (name) => set(i, { ...a, name }),
                    `Assertion ${i + 1} header`,
                    'w-40',
                  )}
                  {opSelect(a, i)}
                  {!['exists', 'notExists'].includes(a.op) &&
                    text(
                      a.value,
                      (value) => set(i, { ...a, value }),
                      `Assertion ${i + 1} expected`,
                      'flex-1 min-w-32',
                    )}
                </>
              )}
              {a.type === 'jsonPath' && (
                <>
                  {text(
                    a.path,
                    (path) => set(i, { ...a, path }),
                    `Assertion ${i + 1} JSON path`,
                    'w-48',
                  )}
                  {opSelect(a, i)}
                  {!['exists', 'notExists'].includes(a.op) &&
                    text(
                      a.value,
                      (value) => set(i, { ...a, value }),
                      `Assertion ${i + 1} expected`,
                      'flex-1 min-w-32',
                    )}
                </>
              )}
              {a.type === 'jsonSchema' && (
                <textarea
                  aria-label={`Assertion ${i + 1} JSON schema`}
                  readOnly={readOnly}
                  spellCheck={false}
                  value={a.schema}
                  onChange={(e) => set(i, { ...a, schema: e.target.value })}
                  className="min-h-16 min-w-60 flex-1 rounded-md border bg-card p-2 font-mono text-[12px]"
                />
              )}
              {a.type === 'responseTime' && (
                <>
                  <span className="text-xs text-muted-foreground">below</span>
                  <Input
                    type="number"
                    min={1}
                    value={a.lessThanMs}
                    readOnly={readOnly}
                    aria-label={`Assertion ${i + 1} max milliseconds`}
                    onChange={(e) => set(i, { ...a, lessThanMs: Number(e.target.value) || 1 })}
                    className="h-8 w-28 font-mono text-[12.5px]"
                  />
                  <span className="text-xs text-muted-foreground">ms</span>
                </>
              )}
              {a.type === 'bodyContains' &&
                text(
                  a.value,
                  (value) => set(i, { ...a, value }),
                  `Assertion ${i + 1} text`,
                  'flex-1 min-w-40',
                )}
              <span className="ml-auto flex items-center gap-1">
                {out &&
                  (out.passed ? (
                    <Check className="size-4 text-success-text" aria-label="Passed" />
                  ) : (
                    <X className="size-4 text-destructive-text" aria-label="Failed" />
                  ))}
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-7"
                    aria-label={`Remove assertion ${i + 1}`}
                    onClick={() => onChange(assertions.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {!readOnly && (
        <Select
          value=""
          onValueChange={(t) => onChange([...assertions, newAssertion(t as Assertion['type'])])}
        >
          <SelectTrigger aria-label="Add assertion" className="h-8 w-44 text-xs text-primary">
            <Plus className="size-3.5" /> <SelectValue placeholder="Add assertion" />
          </SelectTrigger>
          <SelectContent>
            {ASSERTION_TYPES.map(([t, l]) => (
              <SelectItem key={t} value={t}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export function ExtractEditor({
  rules,
  onChange,
  readOnly,
}: {
  rules: ExtractRule[];
  onChange: (r: ExtractRule[]) => void;
  readOnly?: boolean;
}) {
  const set = (i: number, patch: Partial<ExtractRule>) =>
    onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">
        Save values from the response as variables. Later requests in the collection can use them as{' '}
        {'{{name}}'}.
      </p>
      <ul className="grid gap-2" aria-label="Extract rules">
        {rules.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
            <Input
              value={r.variable}
              readOnly={readOnly}
              aria-label={`Rule ${i + 1} variable`}
              placeholder="variable"
              onChange={(e) => set(i, { variable: e.target.value })}
              className="h-8 w-40 font-mono text-[12.5px]"
            />
            <span className="text-xs text-muted-foreground">from</span>
            <Select
              value={r.from}
              disabled={readOnly}
              onValueChange={(from) => set(i, { from: from as ExtractRule['from'] })}
            >
              <SelectTrigger aria-label={`Rule ${i + 1} source`} className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="jsonPath">JSON path</SelectItem>
                <SelectItem value="header">Header</SelectItem>
                <SelectItem value="status">Status</SelectItem>
              </SelectContent>
            </Select>
            {r.from !== 'status' && (
              <Input
                value={r.path}
                readOnly={readOnly}
                aria-label={`Rule ${i + 1} path`}
                placeholder={r.from === 'header' ? 'location' : '$.id'}
                onChange={(e) => set(i, { path: e.target.value })}
                className="h-8 min-w-40 flex-1 font-mono text-[12.5px]"
              />
            )}
            {!readOnly && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto size-7"
                aria-label={`Remove rule ${i + 1}`}
                onClick={() => onChange(rules.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit text-primary"
          onClick={() => onChange([...rules, { variable: '', from: 'jsonPath', path: '$.' }])}
        >
          <Plus /> Add rule
        </Button>
      )}
    </div>
  );
}

function prettyBody(body: string, headers: Record<string, string>) {
  const ct = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  if (ct.includes('json') || /^\s*[[{]/.test(body)) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      /* not JSON after all */
    }
  }
  return body;
}

function formatSize(n: number) {
  return n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
}

/** Response panel: body / headers, plus assertion results and extracted variables on the side. */
export function ResponseView({ result }: { result: ApiExecution }) {
  const [tab, setTab] = useState<'body' | 'headers' | 'request'>('body');
  const res = result.exchange.response;
  const passed = result.assertions.filter((a) => a.passed).length;
  const okStatus = res && res.status < 400;
  return (
    <section
      aria-label="Response"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card"
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">Response</h2>
        {res ? (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-semibold',
              okStatus
                ? 'bg-success-subtle text-success-text'
                : 'bg-destructive-subtle text-destructive-text',
            )}
          >
            {res.status} {res.statusText}
          </span>
        ) : (
          <span className="rounded-full bg-destructive-subtle px-2 py-0.5 text-xs font-semibold text-destructive-text">
            No response
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {formatMs(result.durationMs)}
          {res && ` · ${formatSize(res.size)}`}
          {res?.truncated && ' · truncated'}
        </span>
        <div role="tablist" aria-label="Response view" className="ml-auto flex gap-1">
          {(['body', 'headers', 'request'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium capitalize',
                tab === t
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        {result.assertions.length > 0 && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-semibold',
              passed === result.assertions.length
                ? 'bg-success-subtle text-success-text'
                : 'bg-warning-subtle text-warning-text',
            )}
          >
            {passed} / {result.assertions.length} assertions passed
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div
          className="min-h-48 min-w-0 flex-1 overflow-auto bg-muted/40"
          role="tabpanel"
          aria-label={tab}
        >
          {result.error && (
            <p
              role="alert"
              className="m-3 rounded-lg bg-destructive-subtle p-3 text-sm text-destructive-text"
            >
              {result.error}
            </p>
          )}
          {result.missingVariables.length > 0 && (
            <p className="m-3 rounded-lg bg-warning-subtle p-3 text-sm text-warning-text">
              Unknown variables: {result.missingVariables.map((v) => `{{${v}}}`).join(', ')}. Check
              the environment and collection variables.
            </p>
          )}
          {tab === 'body' && res && (
            <pre className="p-3 font-mono text-[12.5px] leading-5 whitespace-pre-wrap break-all">
              {prettyBody(res.body, res.headers) || (
                <span className="text-muted-foreground">Empty body</span>
              )}
            </pre>
          )}
          {tab === 'headers' && res && <HeaderList headers={res.headers} />}
          {tab === 'request' && (
            <div className="p-3">
              <p className="mb-2 font-mono text-[12.5px] break-all">
                {result.exchange.request.method} {result.exchange.request.url}
              </p>
              <HeaderList headers={result.exchange.request.headers} />
              {result.exchange.request.body && (
                <pre className="mt-2 font-mono text-[12.5px] whitespace-pre-wrap break-all">
                  {result.exchange.request.body}
                </pre>
              )}
            </div>
          )}
        </div>
        {(result.assertions.length > 0 || Object.keys(result.extracted).length > 0) && (
          <aside
            className="grid content-start gap-2 border-t p-3 lg:w-80 lg:border-t-0 lg:border-l"
            aria-label="Checks"
          >
            {result.assertions.length > 0 && (
              <>
                <h3 className="text-xs font-semibold text-muted-foreground">Assertions</h3>
                <ul className="grid gap-1">
                  {result.assertions.map((a, i) => (
                    <li
                      key={i}
                      className={cn(
                        'flex gap-2 rounded-md p-2 text-xs',
                        !a.passed && 'bg-destructive-subtle',
                      )}
                    >
                      {a.passed ? (
                        <Check
                          className="mt-px size-3.5 shrink-0 text-success-text"
                          aria-label="Passed"
                        />
                      ) : (
                        <X
                          className="mt-px size-3.5 shrink-0 text-destructive-text"
                          aria-label="Failed"
                        />
                      )}
                      <span className="min-w-0">
                        <span className="font-medium">{describeAssertion(a.assertion)}</span>
                        {(a.message || a.actual) && (
                          <span
                            className={cn(
                              'block break-words',
                              a.passed ? 'text-muted-foreground' : 'text-destructive-text',
                            )}
                          >
                            {a.message || `got ${a.actual}`}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {Object.keys(result.extracted).length > 0 && (
              <>
                <h3 className="text-xs font-semibold text-muted-foreground">Extracted</h3>
                <ul className="grid gap-1">
                  {Object.entries(result.extracted).map(([k, v]) => (
                    <li
                      key={k}
                      className="truncate rounded-md border px-2 py-1.5 font-mono text-xs"
                    >
                      <span className="text-primary">{k}</span>{' '}
                      <span className="text-muted-foreground">= {v}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}

function HeaderList({ headers }: { headers: Record<string, string> }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,max-content)_1fr] gap-x-4 gap-y-1 p-3 font-mono text-[12px]">
      {Object.entries(headers).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function describeAssertion(a: Assertion): string {
  switch (a.type) {
    case 'status':
      return `Status ${OP_LABEL[a.op]} ${a.value}`;
    case 'header':
      return `Header ${a.name} ${OP_LABEL[a.op]}${a.value ? ` ${a.value}` : ''}`;
    case 'jsonPath':
      return `${a.path} ${OP_LABEL[a.op]}${a.value ? ` ${a.value}` : ''}`;
    case 'jsonSchema':
      return 'Body matches JSON schema';
    case 'responseTime':
      return `Response time below ${a.lessThanMs} ms`;
    case 'bodyContains':
      return `Body contains "${a.value}"`;
  }
}
