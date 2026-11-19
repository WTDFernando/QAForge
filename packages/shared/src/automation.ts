import { z } from 'zod';
import { patchOf } from './zod-utils';

// ---- API testing --------------------------------------------------------------

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const keyValueSchema = z.object({
  name: z.string().trim().max(200),
  value: z.string().max(10_000).default(''),
  enabled: z.boolean().default(true),
});
export type KeyValue = z.infer<typeof keyValueSchema>;

/**
 * Auth helpers. Secret values are written as references like {{env.API_TOKEN}}: they resolve at
 * run time from the run's environment secrets and are never stored in the request.
 */
export const apiAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('inherit') }),
  z.object({ type: z.literal('bearer'), token: z.string().max(5000) }),
  z.object({
    type: z.literal('basic'),
    username: z.string().max(500),
    password: z.string().max(5000),
  }),
  z.object({
    type: z.literal('apiKey'),
    key: z.string().trim().min(1).max(200),
    value: z.string().max(5000),
    in: z.enum(['header', 'query']).default('header'),
  }),
  z.object({
    type: z.literal('oauth2'),
    grant: z.literal('client_credentials').default('client_credentials'),
    tokenUrl: z.string().max(2000),
    clientId: z.string().max(500),
    clientSecret: z.string().max(5000),
    scope: z.string().max(1000).default(''),
  }),
]);
export type ApiAuth = z.infer<typeof apiAuthSchema>;

export const apiBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('json'), content: z.string().max(1_000_000) }),
  z.object({
    type: z.literal('text'),
    content: z.string().max(1_000_000),
    contentType: z.string().max(200).default('text/plain'),
  }),
  z.object({ type: z.literal('form'), fields: z.array(keyValueSchema).max(200) }),
  z.object({
    type: z.literal('graphql'),
    query: z.string().max(200_000),
    variables: z.string().max(200_000).default(''),
  }),
]);
export type ApiBody = z.infer<typeof apiBodySchema>;

export const COMPARE_OPS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'exists',
  'notExists',
  'matches',
  'type',
] as const;
export type CompareOp = (typeof COMPARE_OPS)[number];

export const assertionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('status'),
    op: z.enum(COMPARE_OPS).default('eq'),
    value: z.string().max(50),
  }),
  z.object({
    type: z.literal('header'),
    name: z.string().trim().min(1).max(200),
    op: z.enum(COMPARE_OPS).default('exists'),
    value: z.string().max(5000).default(''),
  }),
  z.object({
    type: z.literal('jsonPath'),
    path: z.string().trim().min(1).max(500),
    op: z.enum(COMPARE_OPS).default('exists'),
    value: z.string().max(5000).default(''),
  }),
  z.object({ type: z.literal('jsonSchema'), schema: z.string().max(200_000) }),
  z.object({ type: z.literal('responseTime'), lessThanMs: z.number().int().min(1).max(600_000) }),
  z.object({ type: z.literal('bodyContains'), value: z.string().min(1).max(5000) }),
]);
export type Assertion = z.infer<typeof assertionSchema>;

export const extractSchema = z.object({
  variable: z
    .string()
    .trim()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use letters, numbers and _'),
  from: z.enum(['jsonPath', 'header', 'status']),
  path: z.string().max(500).default(''),
});
export type ExtractRule = z.infer<typeof extractSchema>;

export const apiCollectionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).default(''),
  parentId: z.uuid().nullable().optional(),
  variables: z.record(z.string().max(100), z.string().max(10_000)).default({}),
  auth: apiAuthSchema.default({ type: 'none' }),
});
export const updateApiCollectionSchema = patchOf(apiCollectionSchema);
export type ApiCollectionInput = z.infer<typeof apiCollectionSchema>;

export const apiRequestSchema = z.object({
  collectionId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  method: z.enum(HTTP_METHODS).default('GET'),
  url: z.string().trim().min(1).max(4000),
  headers: z.array(keyValueSchema).max(100).default([]),
  query: z.array(keyValueSchema).max(100).default([]),
  body: apiBodySchema.default({ type: 'none' }),
  auth: apiAuthSchema.nullable().default(null),
  assertions: z.array(assertionSchema).max(50).default([]),
  extract: z.array(extractSchema).max(50).default([]),
  testCaseId: z.uuid().nullable().optional(),
});
export const updateApiRequestSchema = patchOf(apiRequestSchema);
export type ApiRequestInput = z.infer<typeof apiRequestSchema>;

/** Run one request ad hoc from the editor (unsaved edits allowed). */
export const sendApiRequestSchema = apiRequestSchema
  .omit({ collectionId: true, name: true, testCaseId: true })
  .extend({
    collectionId: z.uuid(),
    environmentId: z.uuid().nullable().optional(),
    /** Variables carried over from earlier requests (chaining in the editor). */
    variables: z.record(z.string().max(100), z.string().max(10_000)).default({}),
  });
export type SendApiRequestInput = z.infer<typeof sendApiRequestSchema>;

export const IMPORT_FORMATS = ['postman', 'bruno', 'openapi', 'curl'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];
export const importCollectionSchema = z.object({
  format: z.enum(IMPORT_FORMATS),
  content: z.string().min(1).max(5_000_000),
  fileName: z.string().max(300).default(''),
  /** Import into an existing collection (cURL) or create a new one. */
  collectionId: z.uuid().optional(),
});
export type ImportCollectionInput = z.infer<typeof importCollectionSchema>;

// ---- Playwright UI tests ---------------------------------------------------------------

export const AUTOMATION_TEST_STATUSES = ['ACTIVE', 'QUARANTINED', 'DISABLED'] as const;
export type AutomationTestStatus = (typeof AUTOMATION_TEST_STATUSES)[number];

/** Workspace-relative file path: folders + name, must end in .spec.ts, no traversal. */
export const testPathSchema = z
  .string()
  .trim()
  .max(300)
  .regex(
    /^(?:[a-z0-9][a-z0-9-_]*\/){0,5}[a-z0-9][a-z0-9-_.]*\.spec\.ts$/i,
    'Use folders and a name ending in .spec.ts, e.g. checkout/pay.spec.ts',
  );

export const automationTestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  path: testPathSchema,
  code: z.string().max(200_000),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).default([]),
  testCaseId: z.uuid().nullable().optional(),
  status: z.enum(AUTOMATION_TEST_STATUSES).default('ACTIVE'),
});
export const updateAutomationTestSchema = patchOf(automationTestSchema).extend({
  /** Optimistic concurrency: the version the editor loaded. */
  version: z.number().int().min(1).optional(),
});
export type AutomationTestInput = z.infer<typeof automationTestSchema>;

// ---- runs, schedules, CI --------------------------------------------------------------------

export const automationSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('tests'), testIds: z.array(z.uuid()).min(1).max(1000) }),
  z.object({ kind: z.literal('collections'), collectionIds: z.array(z.uuid()).min(1).max(100) }),
  z.object({
    kind: z.literal('tags'),
    tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).min(1).max(20),
  }),
]);
export type AutomationSelection = z.infer<typeof automationSelectionSchema>;

export const startAutomationRunSchema = z.object({
  selection: automationSelectionSchema,
  environmentId: z.uuid().nullable().optional(),
  build: z.string().trim().max(100).nullable().optional(),
  retries: z.number().int().min(0).max(3).default(1),
});
export type StartAutomationRunInput = z.infer<typeof startAutomationRunSchema>;

/** 5-field cron: minute hour day-of-month month day-of-week (numbers, *, ranges, lists, steps). */
export const cronSchema = z
  .string()
  .trim()
  .regex(/^(\S+\s+){4}\S+$/, 'Use 5 fields: minute hour day month weekday')
  .refine(
    (c) =>
      c.split(/\s+/).every((f) => /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/.test(f)),
    'Each field may use numbers, *, ranges (1-5), lists (1,3) and steps (*/15)',
  );

export const automationScheduleSchema = z.object({
  name: z.string().trim().min(1).max(200),
  cron: cronSchema,
  timezone: z.string().trim().max(60).default('UTC'),
  selection: automationSelectionSchema,
  environmentId: z.uuid().nullable().optional(),
  enabled: z.boolean().default(true),
});
export const updateAutomationScheduleSchema = patchOf(automationScheduleSchema);
export type AutomationScheduleInput = z.infer<typeof automationScheduleSchema>;

export const createProjectTokenSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(730).nullable().default(365),
});

/** CI webhook body (POST /v1/hooks/automation, Authorization: Bearer <project token>). */
export const ciTriggerSchema = z.object({
  selection: automationSelectionSchema.default({ kind: 'all' }),
  environment: z.string().trim().max(40).optional(),
  build: z.string().trim().max(100).optional(),
  /** e.g. the pipeline URL, shown on the run */
  ref: z.string().max(2000).optional(),
});
export type CiTriggerInput = z.infer<typeof ciTriggerSchema>;

export const FAILURE_CLASSES = ['PRODUCT_BUG', 'TEST_BUG', 'FLAKY', 'ENVIRONMENT'] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];
