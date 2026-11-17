import type {
  BugResolution,
  BugSeverity,
  BugStatus,
  ResultStatus,
  StepResult,
  TestRunStatus,
} from '@qaforge/shared';
import type {
  AutomationStatus,
  Role,
  Priority,
  RequirementStatus,
  RequirementType,
  RichTextNode,
  TestCaseStatus,
  TestCaseType,
  TestTechnique,
} from '@qaforge/shared';

export interface Me {
  user: { id: string; name: string; email: string; image: string | null };
  organizations: Array<{ id: string; name: string; slug: string; role: Role }>;
  pendingInvitations: Array<{ id: string; role: Role; organization: { name: string } }>;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  key: string;
  description: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  id: string;
  role: Role;
  createdAt: string;
  user: { id: string; name: string; email: string; image: string | null };
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  actorType: 'USER' | 'API_TOKEN' | 'AI_AGENT' | 'SYSTEM';
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  metadata: Record<string, unknown> | null;
  projectId: string | null;
  createdAt: string;
}

export interface ProjectFull extends Project {
  settings: { modules?: Record<string, boolean> };
}

export interface EnvironmentRow {
  id: string;
  name: string;
  baseUrl: string | null;
  variables: Record<string, string>;
  secretKeys: string[];
  position: number;
}

export interface RequirementRow {
  id: string;
  ref: string;
  seq: number;
  type: RequirementType;
  title: string;
  priority: Priority;
  status: RequirementStatus;
  parentId: string | null;
  position: number;
  clarityScore: number | null;
  aiGenerated: boolean;
  acceptanceCriteriaCount: number;
  testCaseCount: number;
  updatedAt: string;
}

export interface LinkedTestCase {
  id: string;
  ref: string;
  title: string;
  status: TestCaseStatus;
  priority: Priority;
}

export interface RequirementDetail extends Omit<
  RequirementRow,
  'acceptanceCriteriaCount' | 'testCaseCount'
> {
  description: RichTextNode | null;
  descriptionText: string;
  acceptanceCriteria: string[];
  version: number;
  source: {
    id: string;
    name: string;
    kind: string;
    url: string | null;
    attachmentId: string | null;
  } | null;
  testCases: LinkedTestCase[];
  createdAt: string;
}

export interface RequirementSourceRow {
  id: string;
  kind: 'FILE' | 'LINK' | 'JIRA' | 'GITLAB';
  name: string;
  url: string | null;
  status: 'UPLOADED' | 'PROCESSING' | 'PROCESSED' | 'FAILED';
  createdAt: string;
  attachment: { id: string; fileName: string; contentType: string; size: number } | null;
  analysis: {
    summary: string;
    documentQuestions: string[];
    requirementCount: number;
    jobId: string;
  } | null;
  _count: { requirements: number };
}

export interface SuiteRow {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  position: number;
  caseCount: number;
}

export interface TestCaseRow {
  id: string;
  ref: string;
  seq: number;
  title: string;
  suiteId: string | null;
  suite: { id: string; name: string } | null;
  priority: Priority;
  type: TestCaseType;
  technique: TestTechnique | null;
  status: TestCaseStatus;
  automationStatus: AutomationStatus;
  tags: string[];
  estimateMinutes: number | null;
  aiGenerated: boolean;
  aiConfidence: number | null;
  version: number;
  stepCount: number;
  requirements: { id: string; ref: string; title: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface SharedStepRow {
  id: string;
  name: string;
  steps: { action: string; expected: string }[];
  usageCount: number;
}

export interface TestCaseReview {
  verdict: 'good' | 'needs_changes';
  score: number;
  summary: string;
  issues: {
    severity: 'high' | 'medium' | 'low';
    kind: string;
    stepNumber: number | null;
    message: string;
    suggestion: string;
  }[];
  missingCoverage: string[];
  suggestedSteps: { action: string; expected: string }[] | null;
  jobId: string;
  version: number;
  at: string;
}

export interface TestCaseAiNotes {
  rationale?: string;
  coversCriteria?: string[];
  duplicates?: { ref: string; title: string; similarity: number }[];
  model?: string;
  review?: TestCaseReview;
}

export interface TestCaseDetail extends Omit<TestCaseRow, 'stepCount' | 'requirements'> {
  aiNotes: TestCaseAiNotes | null;
  preconditions: string;
  testData: { columns: string[]; rows: string[][] } | null;
  steps: {
    id: string;
    position: number;
    action: string;
    expected: string;
    sharedStepId: string | null;
    sharedStep: { id: string; name: string; steps: { action: string; expected: string }[] } | null;
  }[];
  requirements: {
    id: string;
    ref: string;
    title: string;
    status: RequirementStatus;
    type: RequirementType;
  }[];
}

export interface VersionRow {
  id: string;
  version: number;
  snapshot: Record<string, unknown>;
  createdById: string;
  createdAt: string;
}

export interface SavedViewRow {
  id: string;
  name: string;
  entity: string;
  config: Record<string, unknown>;
  ownerId: string;
  shared: boolean;
}

export interface Dashboard {
  requirements: {
    total: number;
    covered: number;
    coveragePct: number | null;
    highPriorityCoveragePct: number | null;
  };
  testCases: { total: number; byStatus: Record<TestCaseStatus, number>; aiDraftsToReview: number };
  lastRun: null | {
    id: string;
    ref: string;
    name: string;
    status: TestRunStatus;
    passRate: number | null;
    total: number;
    failed: number;
  };
  openBugsBySeverity: null | Record<BugSeverity, number>;
  releaseReadiness: null | { score: number };
  attention: {
    toReview: {
      id: string;
      ref: string;
      title: string;
      status: TestCaseStatus;
      aiGenerated: boolean;
      updatedAt: string;
    }[];
    uncoveredHighPriority: { id: string; ref: string; title: string; priority: Priority }[];
    failedTests: {
      resultId: string;
      ref: string;
      title: string;
      run: { id: string; ref: string };
      hasBug: boolean;
    }[];
    myBugs: { id: string; ref: string; title: string; severity: BugSeverity; status: BugStatus }[];
  };
}

// ---- test runs & bugs (Phase 1 core QA) --------------------------------------

export interface RunCounts {
  total: number;
  byStatus: Record<ResultStatus, number>;
  executed: number;
  progressPct: number;
  passRate: number | null;
}

export interface TestRunRow {
  id: string;
  seq: number;
  ref: string;
  name: string;
  description: string;
  status: TestRunStatus;
  build: string | null;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  environment: { id: string; name: string; baseUrl?: string | null } | null;
  counts: RunCounts;
  createdAt: string;
}

export interface RunResultRow {
  id: string;
  testCaseId: string | null;
  position: number;
  status: ResultStatus;
  assigneeId: string | null;
  dataRowIndex: number | null;
  executedAt: string | null;
  ref: string;
  title: string;
  priority: Priority;
  dataRow: Record<string, string> | null;
  bugCount: number;
}

export interface RunSnapshot {
  ref: string;
  title: string;
  preconditions: string;
  steps: { action: string; expected: string }[];
  testData: { columns: string[]; rows: string[][] } | null;
  priority: Priority;
  type: string;
}

export interface AttachmentRow {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED' | 'SKIPPED';
  annotations?: Annotation[] | null;
  createdAt: string;
}

export interface Annotation {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  source: 'ai' | 'user';
}

export interface RunResultDetail {
  id: string;
  testRunId: string;
  testCaseId: string | null;
  status: ResultStatus;
  snapshot: RunSnapshot;
  stepResults: StepResult[] | null;
  notes: string;
  durationSec: number | null;
  assigneeId: string | null;
  dataRowIndex: number | null;
  executedAt: string | null;
  executedById: string | null;
  bugs: { id: string; ref: string; title: string; status: BugStatus; severity: BugSeverity }[];
  attachments: AttachmentRow[];
}

export interface BugRow {
  id: string;
  seq: number;
  ref: string;
  title: string;
  status: BugStatus;
  resolution: BugResolution | null;
  severity: BugSeverity;
  priority: Priority;
  component: string | null;
  assigneeId: string | null;
  createdById: string;
  rank: number;
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  attachmentCount: number;
  aiConfidence: number | null;
  possibleDuplicate: { ref: string; similarity: number } | null;
  _count: { testCases: number };
}

export interface BugDetail extends Omit<
  BugRow,
  'commentCount' | 'attachmentCount' | 'aiConfidence' | 'possibleDuplicate' | '_count'
> {
  description: unknown;
  descriptionText: string;
  stepsToReproduce: string[];
  expectedResult: string;
  actualResult: string;
  envDetails: {
    browser?: string;
    os?: string;
    device?: string;
    build?: string;
    url?: string;
    viewport?: string;
  };
  environment: { id: string; name: string } | null;
  duplicateOf: { id: string; ref: string; title: string; status: BugStatus } | null;
  duplicates: { id: string; ref: string; title: string; status: BugStatus }[];
  testCases: { id: string; ref: string; title: string; status: string }[];
  foundIn: {
    resultId: string;
    run: { id: string; ref: string; name: string };
    testCase: { ref: string; title: string } | null;
    failedStep: { index: number; action: string; expected: string } | null;
  } | null;
  aiNotes: {
    confidence?: number | null;
    rationale?: string;
    missingInfo?: string[];
    duplicates?: { ref: string; similarity: number }[];
    model?: string | null;
  } | null;
  attachments: AttachmentRow[];
  version: number;
  closedAt: string | null;
}

export interface CommentRow {
  id: string;
  body: unknown;
  bodyText: string;
  authorId: string;
  author: { id: string; name: string; image: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string | null;
  /** In-app path resolved by the API (null when the item is gone). */
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface BugDraft {
  draft: {
    title: string;
    summary: string;
    stepsToReproduce: string[];
    expectedResult: string;
    actualResult: string;
    severity: BugSeverity;
    priority: Priority;
    component: string | null;
    envDetails: Record<string, string>;
    environmentId: string | null;
    attachmentId: string | null;
    annotations: Annotation[];
  };
  confidence: number;
  rationale: string;
  missingInfo: string[];
  duplicates: { id: string; ref: string; title: string; status: BugStatus; similarity: number }[];
}
