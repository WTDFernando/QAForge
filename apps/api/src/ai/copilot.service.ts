import { BadRequestException, Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { costUsd, loadPrompt, toTokenUsage } from '@qaforge/ai';
import { Prisma } from '@qaforge/db';
import {
  formatRef,
  parseRef,
  PRIORITIES,
  TEST_CASE_STATUSES,
  type CopilotRequest,
} from '@qaforge/shared';
import type { ProjectCtx } from '../common/project-scope';
import { PrismaService } from '../prisma/prisma.module';
import { AgentJobsService } from './agent-jobs.service';
import { AiSettingsService } from './ai-settings.service';

export type CopilotEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; label: string }
  | { type: 'job'; jobId: string; summary: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

const TOOL_LABELS: Record<string, string> = {
  project_overview: 'Reading project stats',
  search_requirements: 'Searching requirements',
  get_requirement: 'Opening requirement',
  search_test_cases: 'Searching test cases',
  get_test_case: 'Opening test case',
  start_test_case_generation: 'Starting test case generation',
};

const MAX_TURNS = 8;

@Injectable()
export class CopilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
    private readonly jobs: AgentJobsService,
  ) {}

  /** Read-only project tools (+ one action that only creates drafts). Every result cites refs. */
  tools(ctx: ProjectCtx, emit: (e: CopilotEvent) => void) {
    const db = this.prisma.client;
    const pid = ctx.projectId;
    const reqBySeq = async (ref: string) => {
      const p = parseRef(ref);
      if (p?.kind !== 'requirement') return null;
      return db.requirement.findFirst({ where: { projectId: pid, seq: p.seq, deletedAt: null } });
    };
    return [
      betaZodTool({
        name: 'project_overview',
        description:
          'Counts of requirements and test cases, test cases by status, and requirement coverage for the current project.',
        inputSchema: z.object({}),
        run: async () => JSON.stringify(await this.overview(pid)),
      }),
      betaZodTool({
        name: 'search_requirements',
        description:
          'Find requirements by text and/or priority. Set uncoveredOnly to list requirements that have no test cases.',
        inputSchema: z.object({
          query: z.string().optional().describe('Words in the title or description'),
          priorities: z.array(z.enum(PRIORITIES)).optional(),
          uncoveredOnly: z.boolean().optional(),
        }),
        run: async (i) => {
          const rows = await db.requirement.findMany({
            where: {
              projectId: pid,
              deletedAt: null,
              ...(i.priorities?.length ? { priority: { in: i.priorities } } : {}),
              ...(i.query
                ? {
                    OR: [
                      { title: { contains: i.query, mode: 'insensitive' } },
                      { descriptionText: { contains: i.query, mode: 'insensitive' } },
                    ],
                  }
                : {}),
              ...(i.uncoveredOnly
                ? { testCases: { none: { testCase: { deletedAt: null } } } }
                : {}),
            },
            select: {
              seq: true,
              title: true,
              type: true,
              priority: true,
              status: true,
              clarityScore: true,
              _count: { select: { testCases: { where: { testCase: { deletedAt: null } } } } },
            },
            orderBy: [{ priority: 'desc' }, { seq: 'asc' }],
            take: 40,
          });
          return JSON.stringify(
            rows.map((r) => ({
              id: formatRef('requirement', r.seq),
              title: r.title,
              type: r.type,
              priority: r.priority,
              status: r.status,
              clarity: r.clarityScore,
              testCases: r._count.testCases,
            })),
          );
        },
      }),
      betaZodTool({
        name: 'get_requirement',
        description:
          'Full details of one requirement (by ID like REQ-0007), including acceptance criteria and linked test cases.',
        inputSchema: z.object({ id: z.string() }),
        run: async ({ id }) => {
          const r = await reqBySeq(id);
          if (!r) return `No requirement ${id} in this project.`;
          const links = await db.requirementTestCase.findMany({
            where: { requirementId: r.id, testCase: { deletedAt: null } },
            select: { testCase: { select: { seq: true, title: true, status: true } } },
          });
          return JSON.stringify({
            id: formatRef('requirement', r.seq),
            title: r.title,
            type: r.type,
            priority: r.priority,
            status: r.status,
            description: r.descriptionText.slice(0, 4000),
            acceptanceCriteria: r.acceptanceCriteria,
            clarity: r.clarityScore,
            openQuestions: (r.aiAnalysis as { questions?: string[] } | null)?.questions ?? [],
            testCases: links.map((l) => ({
              id: formatRef('testCase', l.testCase.seq),
              title: l.testCase.title,
              status: l.testCase.status,
            })),
          });
        },
      }),
      betaZodTool({
        name: 'search_test_cases',
        description:
          'Find test cases by text, status or priority; aiDraftsOnly lists AI drafts awaiting review.',
        inputSchema: z.object({
          query: z.string().optional(),
          statuses: z.array(z.enum(TEST_CASE_STATUSES)).optional(),
          priorities: z.array(z.enum(PRIORITIES)).optional(),
          aiDraftsOnly: z.boolean().optional(),
        }),
        run: async (i) => {
          const rows = await db.testCase.findMany({
            where: {
              projectId: pid,
              deletedAt: null,
              ...(i.query ? { title: { contains: i.query, mode: 'insensitive' } } : {}),
              ...(i.statuses?.length ? { status: { in: i.statuses } } : {}),
              ...(i.priorities?.length ? { priority: { in: i.priorities } } : {}),
              ...(i.aiDraftsOnly ? { aiGenerated: true, status: 'DRAFT' } : {}),
            },
            select: {
              seq: true,
              title: true,
              status: true,
              priority: true,
              aiGenerated: true,
              requirements: { select: { requirement: { select: { seq: true } } } },
            },
            orderBy: { seq: 'desc' },
            take: 40,
          });
          return JSON.stringify(
            rows.map((t) => ({
              id: formatRef('testCase', t.seq),
              title: t.title,
              status: t.status,
              priority: t.priority,
              ai: t.aiGenerated,
              requirements: t.requirements.map((l) => formatRef('requirement', l.requirement.seq)),
            })),
          );
        },
      }),
      betaZodTool({
        name: 'get_test_case',
        description:
          'Full details of one test case (by ID like TC-0042): steps, expected results, linked requirements.',
        inputSchema: z.object({ id: z.string() }),
        run: async ({ id }) => {
          const p = parseRef(id);
          if (p?.kind !== 'testCase') return `"${id}" is not a test case ID.`;
          const t = await db.testCase.findFirst({
            where: { projectId: pid, seq: p.seq, deletedAt: null },
            include: {
              steps: { orderBy: { position: 'asc' }, include: { sharedStep: true } },
              requirements: { select: { requirement: { select: { seq: true, title: true } } } },
            },
          });
          if (!t) return `No test case ${id} in this project.`;
          return JSON.stringify({
            id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            preconditions: t.preconditions,
            steps: t.steps.map((s) =>
              s.sharedStep
                ? { shared: s.sharedStep.name }
                : { action: s.action, expected: s.expected },
            ),
            requirements: t.requirements.map((l) => ({
              id: formatRef('requirement', l.requirement.seq),
              title: l.requirement.title,
            })),
          });
        },
      }),
      betaZodTool({
        name: 'start_test_case_generation',
        description:
          'Start the Test Case Writer for up to 10 requirements (IDs like REQ-0007). Creates DRAFT test cases for human review. Only use when the user asks to generate test cases.',
        inputSchema: z.object({ requirementIds: z.array(z.string()).min(1).max(10) }),
        run: async ({ requirementIds }) => {
          const rows = await Promise.all(requirementIds.map(reqBySeq));
          const found = rows.filter((r): r is NonNullable<typeof r> => !!r);
          if (!found.length) return 'None of those requirement IDs exist in this project.';
          try {
            const job = await this.jobs.start(ctx, {
              kind: 'generate-test-cases',
              requirementIds: found.map((r) => r.id),
              maxCasesPerRequirement: 6,
            });
            const refs = found.map((r) => formatRef('requirement', r.seq)).join(', ');
            emit({ type: 'job', jobId: job.id, summary: `Generating test cases for ${refs}` });
            return `Started generation for ${refs}. Drafts will appear in the review queue when the job finishes.`;
          } catch (e) {
            return `Could not start generation: ${(e as Error).message}`;
          }
        },
      }),
    ];
  }

  async overview(pid: string) {
    const db = this.prisma.client;
    const [reqs, covered, byStatus, aiDrafts] = await Promise.all([
      db.requirement.count({ where: { projectId: pid, deletedAt: null } }),
      db.requirement.count({
        where: {
          projectId: pid,
          deletedAt: null,
          testCases: { some: { testCase: { deletedAt: null } } },
        },
      }),
      db.testCase.groupBy({
        by: ['status'],
        where: { projectId: pid, deletedAt: null },
        _count: true,
      }),
      db.testCase.count({
        where: { projectId: pid, deletedAt: null, aiGenerated: true, status: 'DRAFT' },
      }),
    ]);
    return {
      requirements: reqs,
      requirementsWithTests: covered,
      testCasesByStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count])),
      aiDraftsAwaitingReview: aiDrafts,
    };
  }

  async *chat(ctx: ProjectCtx, req: CopilotRequest): AsyncGenerator<CopilotEvent> {
    const stored = await this.settings.stored(ctx.organizationId);
    if (stored.disabledAgents?.includes('copilot'))
      throw new BadRequestException('QA Copilot is disabled for your organization');
    if (!this.settings.isConfigured(stored))
      throw new BadRequestException(
        'AI is not set up yet. An Admin can add an Anthropic API key in Settings > AI.',
      );
    if (
      stored.monthlyBudgetUsd != null &&
      (await this.settings.monthSpend(ctx.organizationId)) >= stored.monthlyBudgetUsd
    ) {
      throw new BadRequestException("This month's AI budget has been reached");
    }

    if (process.env.QAFORGE_AI_PROVIDER === 'fake') {
      yield* this.fakeChat(ctx, req);
      return;
    }

    const queue: CopilotEvent[] = [];
    const tools = this.tools(ctx, (e) => queue.push(e));
    const client = new Anthropic({ apiKey: this.settings.apiKey(stored), maxRetries: 2 });
    const model = stored.model ?? process.env.AI_DEFAULT_MODEL ?? 'claude-opus-5-5';
    const project = await this.prisma.client.project.findUniqueOrThrow({
      where: { id: ctx.projectId },
      select: { name: true, key: true },
    });

    const runner = client.beta.messages.toolRunner({
      model,
      max_tokens: 16000,
      max_iterations: MAX_TURNS,
      system: [
        { type: 'text', text: loadPrompt('copilot', 'v1'), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `Current project: ${project.name} (key ${project.key}).` },
      ],
      output_config: { effort: 'medium' },
      tools,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    });

    for await (const messageStream of runner) {
      for await (const event of messageStream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          yield {
            type: 'tool',
            name: event.content_block.name,
            label: TOOL_LABELS[event.content_block.name] ?? 'Working',
          };
        }
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
          yield { type: 'text', delta: event.delta.text };
      }
      const message = await messageStream.finalMessage();
      await this.logUsage(ctx, message.model, message.usage);
      while (queue.length) yield queue.shift()!;
      if (message.stop_reason === 'refusal') {
        yield { type: 'error', message: 'The AI model declined to answer this.' };
        return;
      }
    }
    while (queue.length) yield queue.shift()!;
    yield { type: 'done' };
  }

  /** Offline mode: answers from real project data without a model call. */
  private async *fakeChat(ctx: ProjectCtx, req: CopilotRequest): AsyncGenerator<CopilotEvent> {
    yield { type: 'tool', name: 'project_overview', label: TOOL_LABELS.project_overview! };
    const data = await this.overview(ctx.projectId);
    const q = req.messages.at(-1)!.content.slice(0, 80);
    for (const chunk of [
      `(Offline demo mode) You asked: “${q}”. `,
      `This project has ${data.requirements} requirements; `,
      `${data.requirementsWithTests} of them have test cases.`,
    ]) {
      yield { type: 'text', delta: chunk };
    }
    yield { type: 'done' };
  }

  private async logUsage(ctx: ProjectCtx, model: string, usage: Anthropic.Beta.BetaUsage) {
    const u = toTokenUsage(usage);
    await this.prisma.client.aiUsage.create({
      data: {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        agent: 'copilot',
        provider: 'anthropic',
        model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens,
        cacheWriteTokens: u.cacheWriteTokens,
        costUsd: new Prisma.Decimal(costUsd(model, u)),
        createdById: ctx.actor.id,
      },
    });
  }
}
