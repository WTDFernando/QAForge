import { z } from 'zod';
import { patchOf } from './zod-utils';

// ---- enums (mirror Prisma enums) -------------------------------------------

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const REQUIREMENT_TYPES = ['EPIC', 'FEATURE', 'STORY'] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];
export const REQUIREMENT_STATUSES = ['DRAFT', 'APPROVED', 'OBSOLETE'] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];
/** Allowed parent type for each requirement type (Epic -> Feature -> Story). */
export const REQUIREMENT_PARENT: Record<RequirementType, RequirementType | null> = {
  EPIC: null,
  FEATURE: 'EPIC',
  STORY: 'FEATURE',
};

export const TEST_CASE_STATUSES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'DEPRECATED'] as const;
export type TestCaseStatus = (typeof TEST_CASE_STATUSES)[number];
export const TEST_CASE_TYPES = [
  'FUNCTIONAL',
  'UI',
  'API',
  'REGRESSION',
  'SMOKE',
  'SECURITY',
  'PERFORMANCE',
  'ACCESSIBILITY',
] as const;
export type TestCaseType = (typeof TEST_CASE_TYPES)[number];
export const TEST_TECHNIQUES = [
  'POSITIVE',
  'NEGATIVE',
  'BOUNDARY',
  'EQUIVALENCE',
  'DECISION_TABLE',
  'STATE_TRANSITION',
  'EDGE_CASE',
  'EXPLORATORY',
] as const;
export type TestTechnique = (typeof TEST_TECHNIQUES)[number];
export const AUTOMATION_STATUSES = [
  'NOT_AUTOMATED',
  'CANDIDATE',
  'AUTOMATED',
  'NOT_APPLICABLE',
] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

/** "DECISION_TABLE" -> "Decision table" */
export function humanize(value: string): string {
  const s = value.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Test case review workflow. Anyone with testcase:write may move between non-approved states;
 * reaching APPROVED requires testcase:approve.
 */
export const TEST_CASE_TRANSITIONS: Record<TestCaseStatus, TestCaseStatus[]> = {
  DRAFT: ['IN_REVIEW', 'APPROVED', 'DEPRECATED'],
  IN_REVIEW: ['DRAFT', 'APPROVED', 'DEPRECATED'],
  APPROVED: ['IN_REVIEW', 'DEPRECATED'],
  DEPRECATED: ['DRAFT'],
};
export function canTransition(from: TestCaseStatus, to: TestCaseStatus): boolean {
  return from === to || TEST_CASE_TRANSITIONS[from].includes(to);
}

// ---- project modules / feature flags ---------------------------------------

export const PROJECT_MODULES = [
  { key: 'requirements', label: 'Requirements', available: true },
  { key: 'testCases', label: 'Test cases', available: true },
  { key: 'testRuns', label: 'Test runs', available: true },
  { key: 'bugs', label: 'Bugs', available: true },
  { key: 'automation', label: 'Automation', available: true },
  { key: 'releases', label: 'Releases', available: false },
  { key: 'reports', label: 'Reports', available: false },
  { key: 'performance', label: 'Performance', available: false, future: true },
  { key: 'security', label: 'Security', available: false, future: true },
  { key: 'accessibility', label: 'Accessibility', available: false, future: true },
  { key: 'visualMobile', label: 'Visual & mobile', available: false, future: true },
] as const;
export type ProjectModuleKey = (typeof PROJECT_MODULES)[number]['key'];

/** Core modules default on; future modules default off until an admin enables them. */
export function moduleEnabled(settings: unknown, key: ProjectModuleKey): boolean {
  const mod = PROJECT_MODULES.find((m) => m.key === key)!;
  const flags = (settings as { modules?: Record<string, boolean> } | null)?.modules ?? {};
  return flags[key] ?? !('future' in mod && mod.future);
}

export const projectSettingsSchema = z.object({
  modules: z
    .partialRecord(
      z.enum(PROJECT_MODULES.map((m) => m.key) as [ProjectModuleKey, ...ProjectModuleKey[]]),
      z.boolean(),
    )
    .optional(),
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

// ---- environments ----------------------------------------------------------

const envVarKey = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use letters, numbers and _');
export const environmentSchema = z.object({
  name: z.string().trim().min(1).max(40),
  baseUrl: z
    .url()
    .max(500)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  variables: z.record(envVarKey, z.string().max(2000)).default({}),
  /** Write-only. Keys mapped to null are deleted; omitted keys are kept. */
  secrets: z.record(envVarKey, z.string().max(4000).nullable()).optional(),
});
export type EnvironmentInput = z.infer<typeof environmentSchema>;
export const updateEnvironmentSchema = patchOf(environmentSchema);

// ---- rich text -------------------------------------------------------------

/** Minimal Tiptap/ProseMirror JSON node shape. */
export interface RichTextNode {
  type?: string;
  text?: string;
  content?: RichTextNode[];
  [k: string]: unknown;
}
/** A Tiptap document ({ type: 'doc', content: [...] }); nested nodes are passed through. */
export const richTextSchema = z
  .looseObject({
    type: z.literal('doc'),
    content: z
      .array(z.looseObject({ type: z.string() }))
      .max(5000)
      .optional(),
  })
  .transform((d) => d as RichTextNode);

const BLOCK = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'tableRow']);
/** Flatten rich text to plain text (search, AI context, exports). */
export function richTextToPlain(doc: RichTextNode | null | undefined): string {
  if (!doc) return '';
  const out: string[] = [];
  const walk = (n: RichTextNode) => {
    if (n.type === 'text' && n.text) out.push(n.text);
    if (n.type === 'hardBreak') out.push('\n');
    n.content?.forEach(walk);
    if (n.type && BLOCK.has(n.type)) out.push('\n');
  };
  walk(doc);
  return out
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---- requirements ----------------------------------------------------------

export const createRequirementSchema = z.object({
  title: z.string().trim().min(1).max(300),
  type: z.enum(REQUIREMENT_TYPES).default('STORY'),
  description: richTextSchema.nullable().optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).max(100).default([]),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  status: z.enum(REQUIREMENT_STATUSES).default('DRAFT'),
  parentId: z.uuid().nullable().optional(),
});
export type CreateRequirementInput = z.infer<typeof createRequirementSchema>;
export const updateRequirementSchema = patchOf(createRequirementSchema);
export type UpdateRequirementInput = z.infer<typeof updateRequirementSchema>;

export const moveSchema = z.object({
  parentId: z.uuid().nullable(),
  /** Insert before this sibling; null = append at the end. */
  beforeId: z.uuid().nullable().optional(),
});
export type MoveInput = z.infer<typeof moveSchema>;

export const linkSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500) });

// ---- test suites -----------------------------------------------------------

export const createSuiteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  parentId: z.uuid().nullable().optional(),
});
export type CreateSuiteInput = z.infer<typeof createSuiteSchema>;
export const updateSuiteSchema = patchOf(createSuiteSchema);

// ---- test cases ------------------------------------------------------------

export const testStepSchema = z.object({
  action: z.string().max(4000).default(''),
  expected: z.string().max(4000).default(''),
  sharedStepId: z.uuid().nullable().optional(),
});
export type TestStepInput = z.infer<typeof testStepSchema>;

export const testDataSchema = z
  .object({
    columns: z.array(z.string().trim().min(1).max(100)).max(30),
    rows: z.array(z.array(z.string().max(2000))).max(200),
  })
  .refine(
    (d) => d.rows.every((r) => r.length === d.columns.length),
    'Every row needs a value per column',
  );
export type TestData = z.infer<typeof testDataSchema>;

const tag = z.string().trim().toLowerCase().min(1).max(40);

export const createTestCaseSchema = z.object({
  title: z.string().trim().min(1).max(300),
  suiteId: z.uuid().nullable().optional(),
  preconditions: z.string().max(10000).default(''),
  steps: z.array(testStepSchema).max(200).default([]),
  testData: testDataSchema.nullable().optional(),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  type: z.enum(TEST_CASE_TYPES).default('FUNCTIONAL'),
  technique: z.enum(TEST_TECHNIQUES).nullable().optional(),
  status: z.enum(TEST_CASE_STATUSES).default('DRAFT'),
  automationStatus: z.enum(AUTOMATION_STATUSES).default('NOT_AUTOMATED'),
  tags: z.array(tag).max(30).default([]),
  estimateMinutes: z.number().int().min(0).max(10000).nullable().optional(),
  requirementIds: z.array(z.uuid()).max(100).default([]),
});
export type CreateTestCaseInput = z.infer<typeof createTestCaseSchema>;

export const updateTestCaseSchema = patchOf(createTestCaseSchema.omit({ status: true })).extend({
  changeNote: z.string().max(500).optional(),
});
export type UpdateTestCaseInput = z.infer<typeof updateTestCaseSchema>;

export const setStatusSchema = z.object({
  status: z.enum(TEST_CASE_STATUSES),
  note: z.string().max(1000).optional(),
});

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
    z.array(z.enum(values)).optional(),
  );

export const TEST_CASE_SORT_FIELDS = [
  'seq',
  'title',
  'priority',
  'status',
  'updatedAt',
  'createdAt',
] as const;

export const testCaseQuerySchema = z.object({
  q: z.string().max(200).optional(),
  suiteId: z.union([z.uuid(), z.literal('none')]).optional(),
  /** Include cases in descendant suites (default true). */
  deep: z.stringbool().default(true),
  status: csv(TEST_CASE_STATUSES),
  priority: csv(PRIORITIES),
  type: csv(TEST_CASE_TYPES),
  automationStatus: csv(AUTOMATION_STATUSES),
  tag: z.string().max(40).optional(),
  requirementId: z.uuid().optional(),
  aiGenerated: z.stringbool().optional(),
  sort: z.enum(TEST_CASE_SORT_FIELDS).default('seq'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
export type TestCaseQuery = z.infer<typeof testCaseQuerySchema>;

export const BULK_TEST_CASE_ACTIONS = [
  'setStatus',
  'setPriority',
  'move',
  'addTags',
  'removeTags',
  'delete',
  'restore',
] as const;
export const bulkTestCaseSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('setStatus'),
    ids: z.array(z.uuid()).min(1).max(1000),
    status: z.enum(TEST_CASE_STATUSES),
  }),
  z.object({
    action: z.literal('setPriority'),
    ids: z.array(z.uuid()).min(1).max(1000),
    priority: z.enum(PRIORITIES),
  }),
  z.object({
    action: z.literal('move'),
    ids: z.array(z.uuid()).min(1).max(1000),
    suiteId: z.uuid().nullable(),
  }),
  z.object({
    action: z.literal('addTags'),
    ids: z.array(z.uuid()).min(1).max(1000),
    tags: z.array(tag).min(1).max(30),
  }),
  z.object({
    action: z.literal('removeTags'),
    ids: z.array(z.uuid()).min(1).max(1000),
    tags: z.array(tag).min(1).max(30),
  }),
  z.object({ action: z.literal('delete'), ids: z.array(z.uuid()).min(1).max(1000) }),
  z.object({ action: z.literal('restore'), ids: z.array(z.uuid()).min(1).max(1000) }),
]);
export type BulkTestCaseInput = z.infer<typeof bulkTestCaseSchema>;

// ---- shared steps & saved views -------------------------------------------

export const sharedStepSchema = z.object({
  name: z.string().trim().min(1).max(120),
  steps: z
    .array(testStepSchema.omit({ sharedStepId: true }))
    .min(1)
    .max(100),
});
export type SharedStepInput = z.infer<typeof sharedStepSchema>;

export const SAVED_VIEW_ENTITIES = ['test_case', 'requirement'] as const;
export const savedViewSchema = z.object({
  entity: z.enum(SAVED_VIEW_ENTITIES),
  name: z.string().trim().min(1).max(80),
  /** Opaque UI state: filters, columns, grouping, sort. */
  config: z.record(z.string(), z.unknown()),
  shared: z.boolean().default(false),
});
export type SavedViewInput = z.infer<typeof savedViewSchema>;

// ---- uploads ---------------------------------------------------------------

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const REQUIREMENT_UPLOAD_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'text/markdown': 'Markdown',
  'text/plain': 'Text',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
};
export const createLinkSourceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.url().max(2000),
});
