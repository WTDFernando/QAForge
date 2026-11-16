import { z } from 'zod';
import { PRIORITIES, TEST_CASE_STATUSES, TEST_CASE_TYPES } from './qa';
import { patchOf } from './zod-utils';

export const TEST_RUN_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED'] as const;
export type TestRunStatus = (typeof TEST_RUN_STATUSES)[number];
export const RESULT_STATUSES = [
  'UNTESTED',
  'PASSED',
  'FAILED',
  'BLOCKED',
  'SKIPPED',
  'RETEST',
] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];
/** Results that count as "executed" for progress. */
export const EXECUTED_STATUSES: readonly ResultStatus[] = [
  'PASSED',
  'FAILED',
  'BLOCKED',
  'SKIPPED',
];

export const RUN_TRANSITIONS: Record<TestRunStatus, TestRunStatus[]> = {
  PLANNED: ['IN_PROGRESS', 'ABORTED'],
  IN_PROGRESS: ['COMPLETED', 'ABORTED'],
  COMPLETED: ['IN_PROGRESS'],
  ABORTED: ['IN_PROGRESS'],
};

/** Which test cases a run includes. */
export const runSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('suite'), suiteId: z.uuid(), deep: z.boolean().default(true) }),
  z.object({
    kind: z.literal('filter'),
    status: z.array(z.enum(TEST_CASE_STATUSES)).optional(),
    priority: z.array(z.enum(PRIORITIES)).optional(),
    type: z.array(z.enum(TEST_CASE_TYPES)).optional(),
    tag: z.string().max(40).optional(),
    requirementId: z.uuid().optional(),
  }),
  z.object({ kind: z.literal('cases'), testCaseIds: z.array(z.uuid()).min(1).max(5000) }),
]);
export type RunSelection = z.infer<typeof runSelectionSchema>;

export const createTestRunSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).default(''),
  environmentId: z.uuid().nullable().optional(),
  build: z.string().trim().max(100).nullable().optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  /** Default assignee for every result. */
  assigneeId: z.uuid().nullable().optional(),
  selection: runSelectionSchema,
  /** Leave out deprecated cases (default) and optionally anything not yet approved. */
  onlyApproved: z.boolean().default(false),
});
export type CreateTestRunInput = z.infer<typeof createTestRunSchema>;

export const updateTestRunSchema = patchOf(
  createTestRunSchema.omit({ selection: true, onlyApproved: true, assigneeId: true }),
).extend({
  status: z.enum(TEST_RUN_STATUSES).optional(),
});
export type UpdateTestRunInput = z.infer<typeof updateTestRunSchema>;

export const stepResultSchema = z.object({
  index: z.number().int().min(0).max(500),
  status: z.enum(RESULT_STATUSES),
  actual: z.string().max(4000).default(''),
});
export type StepResult = z.infer<typeof stepResultSchema>;

export const recordResultSchema = z.object({
  status: z.enum(RESULT_STATUSES).optional(),
  stepResults: z.array(stepResultSchema).max(500).optional(),
  notes: z.string().max(10000).optional(),
  durationSec: z
    .number()
    .int()
    .min(0)
    .max(86400 * 7)
    .nullable()
    .optional(),
  assigneeId: z.uuid().nullable().optional(),
});
export type RecordResultInput = z.infer<typeof recordResultSchema>;

export const assignResultsSchema = z.object({
  resultIds: z.array(z.uuid()).min(1).max(5000),
  assigneeId: z.uuid().nullable(),
});
export const addRunCasesSchema = z.object({ testCaseIds: z.array(z.uuid()).min(1).max(5000) });

export const runResultsQuerySchema = z.object({
  status: z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
    z.array(z.enum(RESULT_STATUSES)).optional(),
  ),
  assigneeId: z.union([z.uuid(), z.literal('me'), z.literal('none')]).optional(),
  q: z.string().max(200).optional(),
});

export const runListQuerySchema = z.object({
  status: z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
    z.array(z.enum(TEST_RUN_STATUSES)).optional(),
  ),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Pass rate over executed results (skipped excluded); null when nothing ran. */
export function passRate(counts: Partial<Record<ResultStatus, number>>): number | null {
  const passed = counts.PASSED ?? 0;
  const denom = passed + (counts.FAILED ?? 0) + (counts.BLOCKED ?? 0);
  return denom === 0 ? null : Math.round((passed / denom) * 1000) / 10;
}
