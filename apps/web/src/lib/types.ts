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
  lastRun: null | { passRate: number };
  openBugsBySeverity: null | Record<string, number>;
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
  };
}
