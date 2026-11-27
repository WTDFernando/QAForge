import { z } from 'zod';

export const AGENT_IDS = [
  'requirement',
  'test-case-writer',
  'test-case-reviewer',
  'bug',
  'automation',
  'failure-analysis',
  'report',
  'copilot',
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const AGENT_INFO: Record<AgentId, { name: string; description: string }> = {
  requirement: {
    name: 'Requirement Agent',
    description:
      'Splits documents into requirements, scores clarity, lists ambiguities and questions.',
  },
  'test-case-writer': {
    name: 'Test Case Writer',
    description: 'Drafts test cases from requirements for you to review.',
  },
  'test-case-reviewer': {
    name: 'Test Case Reviewer',
    description: 'Checks a test case for vague steps, missing results and coverage gaps.',
  },
  bug: {
    name: 'Bug Agent',
    description:
      'Turns a screenshot and a one-line note into a bug report draft, highlights the problem and checks for duplicates.',
  },
  automation: {
    name: 'Automation Agent',
    description:
      'Turns a manual test case into a Playwright test with a page object, and suggests locator fixes when tests break. You approve every change.',
  },
  'failure-analysis': {
    name: 'Failure Analysis Agent',
    description:
      'Explains why automated tests failed: product bug, test bug, flaky test or environment, with the evidence.',
  },
  report: {
    name: 'Report Agent',
    description:
      'Writes the summary, risks and recommendation on reports, using only numbers from the report itself.',
  },
  copilot: {
    name: 'QA Copilot',
    description: 'Answers questions about the project and can start the other agents.',
  },
};

/** Models selectable per organization (first = default). */
export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Best quality (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Faster, about half the cost' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest, lowest cost' },
] as const;
export const DEFAULT_AI_MODEL = AI_MODELS[0].id;

/** PUT body. apiKey is write-only: a string sets it, null removes it, omitted keeps it. */
export const aiSettingsSchema = z.object({
  /** Master switch: false turns every AI feature off for the organization. */
  enabled: z.boolean().default(true),
  model: z.enum(AI_MODELS.map((m) => m.id) as [string, ...string[]]),
  apiKey: z.string().trim().min(20).max(500).nullable().optional(),
  monthlyBudgetUsd: z.number().min(0).max(1_000_000).nullable(),
  disabledAgents: z.array(z.enum(AGENT_IDS)).default([]),
});
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;

/** What the API returns (never the key itself). */
export interface AiSettingsView {
  provider: 'anthropic';
  model: string;
  hasApiKey: boolean;
  /** True when no org key is set but the server has ANTHROPIC_API_KEY configured. */
  usingServerKey: boolean;
  /** Where model calls come from: org key, server key, offline demo provider, or nowhere (agents can't run). */
  mode: 'org-key' | 'server-key' | 'demo' | 'none';
  /** Organization master switch. */
  enabled: boolean;
  /** enabled && a model source is available. */
  ready: boolean;
  monthlyBudgetUsd: number | null;
  disabledAgents: AgentId[];
}

export const startAgentJobSchema = z.discriminatedUnion('kind', [
  /** Requirement Agent on an uploaded document: creates draft requirements. */
  z.object({ kind: z.literal('analyze-source'), sourceId: z.uuid() }),
  /** Requirement Agent on one requirement: clarity score, ambiguities, questions (no content changes). */
  z.object({ kind: z.literal('analyze-requirement'), requirementId: z.uuid() }),
  /** Test Case Writer for one or more requirements: creates draft test cases. */
  z.object({
    kind: z.literal('generate-test-cases'),
    requirementIds: z.array(z.uuid()).min(1).max(25),
    maxCasesPerRequirement: z.number().int().min(1).max(15).default(6),
  }),
  /** Test Case Reviewer on one test case: suggestions only. */
  z.object({ kind: z.literal('review-test-case'), testCaseId: z.uuid() }),
  /** Bug Agent: screenshot + one line -> a bug report draft (the user reviews and submits it). */
  z.object({
    kind: z.literal('draft-bug'),
    note: z.string().trim().min(3).max(2000),
    attachmentId: z.uuid().optional(),
    pageUrl: z.string().max(2000).optional(),
    userAgent: z.string().max(500).optional(),
    environmentId: z.uuid().optional(),
  }),
  /** Automation Agent: manual test case -> Playwright test (created disabled until a person enables it). */
  z.object({
    kind: z.literal('generate-ui-test'),
    testCaseId: z.uuid(),
    environmentId: z.uuid().optional(),
  }),
  /** Automation Agent: suggest a locator fix for a failed UI test (applied only after approval). */
  z.object({ kind: z.literal('repair-ui-test'), automationResultId: z.uuid() }),
  /** Failure Analysis Agent: classify one failed automation result. */
  z.object({ kind: z.literal('analyze-failure'), automationResultId: z.uuid() }),
  /** Report Agent: summary, risks and recommendation for a report, using only its numbers. */
  z.object({ kind: z.literal('write-report'), reportId: z.uuid() }),
]);
export type StartAgentJobInput = z.infer<typeof startAgentJobSchema>;

export const AGENT_FOR_KIND: Record<StartAgentJobInput['kind'], AgentId> = {
  'analyze-source': 'requirement',
  'analyze-requirement': 'requirement',
  'generate-test-cases': 'test-case-writer',
  'review-test-case': 'test-case-reviewer',
  'draft-bug': 'bug',
  'generate-ui-test': 'automation',
  'repair-ui-test': 'automation',
  'analyze-failure': 'failure-analysis',
  'write-report': 'report',
};

export type AgentJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

/** Pushed over SSE whenever a job changes. */
export interface AgentJobEvent {
  id: string;
  organizationId: string;
  projectId: string | null;
  agent: AgentId;
  kind: StartAgentJobInput['kind'];
  status: AgentJobStatus;
  progress: number;
  progressMessage: string | null;
  summary: string | null;
  error: string | null;
  sourceIds: string[];
  createdById: string;
  createdAt: string;
  finishedAt: string | null;
}

export const agentJobChannel = (organizationId: string) => `qaforge:agent-jobs:${organizationId}`;

export interface AiJobPayload {
  jobId: string;
}

export const copilotRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(20000) }))
    .min(1)
    .max(40)
    .refine((m) => m.at(-1)?.role === 'user', 'The last message must be from the user'),
});
export type CopilotRequest = z.infer<typeof copilotRequestSchema>;
