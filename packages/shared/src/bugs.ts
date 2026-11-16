import { z } from 'zod';
import { PRIORITIES, richTextSchema } from './qa';
import { patchOf } from './zod-utils';

export const BUG_SEVERITIES = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL'] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];
export const BUG_STATUSES = [
  'NEW',
  'TRIAGED',
  'IN_PROGRESS',
  'FIXED',
  'READY_FOR_RETEST',
  'CLOSED',
  'REOPENED',
] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];
export const BUG_RESOLUTIONS = [
  'FIXED',
  'DUPLICATE',
  'WONT_FIX',
  'CANNOT_REPRODUCE',
  'BY_DESIGN',
] as const;
export type BugResolution = (typeof BUG_RESOLUTIONS)[number];
export const OPEN_BUG_STATUSES: readonly BugStatus[] = [
  'NEW',
  'TRIAGED',
  'IN_PROGRESS',
  'FIXED',
  'READY_FOR_RETEST',
  'REOPENED',
];

/** New -> Triaged -> In progress -> Fixed -> Ready for retest -> Closed / Reopened. Closing is possible early with a resolution. */
export const BUG_TRANSITIONS: Record<BugStatus, BugStatus[]> = {
  NEW: ['TRIAGED', 'IN_PROGRESS', 'CLOSED'],
  TRIAGED: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['FIXED', 'TRIAGED', 'CLOSED'],
  FIXED: ['READY_FOR_RETEST', 'REOPENED', 'IN_PROGRESS'],
  READY_FOR_RETEST: ['CLOSED', 'REOPENED'],
  CLOSED: ['REOPENED'],
  REOPENED: ['TRIAGED', 'IN_PROGRESS', 'CLOSED'],
};
export function canMoveBug(from: BugStatus, to: BugStatus): boolean {
  return from === to || BUG_TRANSITIONS[from].includes(to);
}

export const envDetailsSchema = z
  .object({
    browser: z.string().max(100).optional(),
    os: z.string().max(100).optional(),
    device: z.string().max(100).optional(),
    build: z.string().max(100).optional(),
    url: z.string().max(2000).optional(),
    viewport: z.string().max(40).optional(),
  })
  .default({});

/** Highlight boxes on a screenshot, normalized to the image (0-1). */
export const annotationSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  label: z.string().max(200).default(''),
  source: z.enum(['ai', 'user']).default('user'),
});
export type Annotation = z.infer<typeof annotationSchema>;
export const annotationsSchema = z.array(annotationSchema).max(20);

export const createBugSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: richTextSchema.nullable().optional(),
  stepsToReproduce: z.array(z.string().trim().min(1).max(2000)).max(50).default([]),
  expectedResult: z.string().max(5000).default(''),
  actualResult: z.string().max(5000).default(''),
  envDetails: envDetailsSchema,
  environmentId: z.uuid().nullable().optional(),
  severity: z.enum(BUG_SEVERITIES).default('MAJOR'),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  component: z.string().trim().max(100).nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  /** Where it was found: a run result (and the failed step). Links the test case automatically. */
  testRunResultId: z.uuid().nullable().optional(),
  failedStepIndex: z.number().int().min(0).nullable().optional(),
  testCaseIds: z.array(z.uuid()).max(50).default([]),
  /** Files uploaded before the bug existed (e.g. the screenshot from quick report). */
  attachmentIds: z.array(z.uuid()).max(20).default([]),
  /** Highlight boxes per attachment, normalized 0-1. */
  attachmentAnnotations: z.record(z.uuid(), annotationsSchema).default({}),
  /** Set when the form was pre-filled by the Bug Agent; marks the bug as AI-assisted. */
  aiJobId: z.uuid().optional(),
});
export type CreateBugInput = z.infer<typeof createBugSchema>;

export const updateBugSchema = patchOf(
  createBugSchema.omit({
    testRunResultId: true,
    failedStepIndex: true,
    attachmentIds: true,
    attachmentAnnotations: true,
    aiJobId: true,
  }),
);
export type UpdateBugInput = z.infer<typeof updateBugSchema>;

export const setBugStatusSchema = z
  .object({
    status: z.enum(BUG_STATUSES),
    resolution: z.enum(BUG_RESOLUTIONS).nullable().optional(),
    duplicateOfId: z.uuid().nullable().optional(),
    /** Kanban: place before this bug in the target column (null = end). */
    beforeId: z.uuid().nullable().optional(),
  })
  .refine((v) => v.status !== 'CLOSED' || !!v.resolution, {
    message: 'Closing a bug needs a resolution',
    path: ['resolution'],
  })
  .refine((v) => v.resolution !== 'DUPLICATE' || !!v.duplicateOfId, {
    message: 'Pick the bug this duplicates',
    path: ['duplicateOfId'],
  });
export type SetBugStatusInput = z.infer<typeof setBugStatusSchema>;

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
    z.array(z.enum(values)).optional(),
  );

export const BUG_SORT_FIELDS = [
  'seq',
  'title',
  'severity',
  'priority',
  'status',
  'updatedAt',
  'createdAt',
] as const;
export const bugQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: csv(BUG_STATUSES),
  severity: csv(BUG_SEVERITIES),
  priority: csv(PRIORITIES),
  /** "me", "none" or a user id */
  assigneeId: z.union([z.uuid(), z.literal('me'), z.literal('none')]).optional(),
  component: z.string().max(100).optional(),
  testCaseId: z.uuid().optional(),
  openOnly: z.stringbool().optional(),
  aiGenerated: z.stringbool().optional(),
  sort: z.enum(BUG_SORT_FIELDS).default('seq'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
export type BugQuery = z.infer<typeof bugQuerySchema>;

export const linkBugTestCasesSchema = z.object({ testCaseIds: z.array(z.uuid()).min(1).max(50) });

// ---- comments & notifications ---------------------------------------------

export const COMMENT_ENTITIES = ['bug', 'test_case', 'requirement'] as const;
export type CommentEntity = (typeof COMMENT_ENTITIES)[number];
export const createCommentSchema = z.object({
  body: richTextSchema,
  /** Mentioned user ids (must be members); they get a notification. */
  mentions: z.array(z.uuid()).max(20).default([]),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const notificationQuerySchema = z.object({
  unreadOnly: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

// ---- project roles ---------------------------------------------------------

export { ROLES as PROJECT_ROLES } from './roles';
