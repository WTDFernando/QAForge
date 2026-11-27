import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Observable } from 'rxjs';
import { Prisma, type AgentJob } from '@qaforge/db';
import {
  AGENT_FOR_KIND,
  agentJobChannel,
  hasPermission,
  QUEUES,
  type AgentId,
  type AgentJobEvent,
  type AiJobPayload,
  type StartAgentJobInput,
} from '@qaforge/shared';
import { env } from '../config/env';
import type { ProjectCtx } from '../common/project-scope';
import { PrismaService } from '../prisma/prisma.module';
import { AiSettingsService } from './ai-settings.service';

/** Extra permission each job kind needs on top of ai:use (it creates or changes these items). */
const KIND_PERMISSION = {
  'analyze-source': 'requirement:write',
  'analyze-requirement': 'requirement:write',
  'generate-test-cases': 'testcase:write',
  'review-test-case': 'testcase:read',
  'draft-bug': 'bug:write',
  'generate-ui-test': 'automation:write',
  'repair-ui-test': 'automation:write',
  'analyze-failure': 'automation:run',
  'write-report': 'report:write',
} as const;

const SOURCE_TYPE = {
  'analyze-source': 'requirement_source',
  'analyze-requirement': 'requirement',
  'generate-test-cases': 'requirement',
  'review-test-case': 'test_case',
  'draft-bug': 'attachment',
  'generate-ui-test': 'test_case',
  'repair-ui-test': 'automation_result',
  'analyze-failure': 'automation_result',
  'write-report': 'report',
} as const;

const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function toEvent(job: AgentJob): AgentJobEvent {
  return {
    id: job.id,
    organizationId: job.organizationId,
    projectId: job.projectId,
    agent: job.agent as AgentId,
    kind: (job.input as StartAgentJobInput).kind,
    status: job.status,
    progress: job.progress,
    progressMessage: job.progressMessage,
    summary: job.summary,
    error: job.error,
    sourceIds: job.sourceIds,
    createdById: job.createdById,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class AgentJobsService implements OnModuleDestroy {
  private readonly connection = new IORedis(env().REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  private readonly publisher = new IORedis(env().REDIS_URL, { lazyConnect: true });
  private readonly queue = new Queue<AiJobPayload>(QUEUES.ai, { connection: this.connection });

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
  ) {
    this.connection.on('error', () => undefined);
    this.publisher.on('error', () => undefined);
  }

  async start(ctx: ProjectCtx, input: StartAgentJobInput) {
    const agent = AGENT_FOR_KIND[input.kind];
    if (!hasPermission(ctx.role, KIND_PERMISSION[input.kind]))
      throw new ForbiddenException('Your role cannot run this agent here');
    const stored = await this.settings.stored(ctx.organizationId);
    this.settings.assertEnabled(stored);
    if (stored.disabledAgents?.includes(agent))
      throw new BadRequestException('This agent is disabled for your organization');
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
    const sourceIds = await this.resolveSources(ctx, input);

    // One active job per source item avoids duplicate drafts from double clicks.
    const active = await this.prisma.client.agentJob.findFirst({
      where: {
        projectId: ctx.projectId,
        agent,
        status: { in: ['QUEUED', 'RUNNING'] },
        sourceIds: { hasSome: sourceIds },
      },
    });
    if (active) return toEvent(active);

    const job = await this.prisma.client.agentJob.create({
      data: {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        agent,
        sourceType: SOURCE_TYPE[input.kind],
        sourceIds,
        input: input as Prisma.InputJsonValue,
        progressMessage: 'Queued',
        createdById: ctx.actor.id,
      },
    });
    await this.queue.add(
      input.kind,
      { jobId: job.id },
      {
        jobId: job.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
    await this.publish(job);
    return toEvent(job);
  }

  /** Validate that every referenced item exists in this project. */
  private async resolveSources(ctx: ProjectCtx, input: StartAgentJobInput): Promise<string[]> {
    const db = this.prisma.client;
    const projectId = ctx.projectId;
    switch (input.kind) {
      case 'analyze-source': {
        const s = await db.requirementSource.findFirst({
          where: { id: input.sourceId, projectId },
        });
        if (!s) throw new NotFoundException('Source not found');
        if (!s.attachmentId)
          throw new BadRequestException(
            'Links can’t be analyzed yet. Upload the document instead.',
          );
        return [s.id];
      }
      case 'analyze-requirement': {
        const r = await db.requirement.findFirst({
          where: { id: input.requirementId, projectId, deletedAt: null },
        });
        if (!r) throw new NotFoundException('Requirement not found');
        return [r.id];
      }
      case 'generate-test-cases': {
        const ids = [...new Set(input.requirementIds)];
        const n = await db.requirement.count({
          where: { id: { in: ids }, projectId, deletedAt: null },
        });
        if (n !== ids.length) throw new NotFoundException('Some requirements were not found');
        return ids;
      }
      case 'review-test-case': {
        const t = await db.testCase.findFirst({
          where: { id: input.testCaseId, projectId, deletedAt: null },
        });
        if (!t) throw new NotFoundException('Test case not found');
        return [t.id];
      }
      case 'draft-bug': {
        if (input.environmentId) {
          const e = await db.environment.findFirst({
            where: { id: input.environmentId, projectId },
          });
          if (!e) throw new NotFoundException('Environment not found');
        }
        if (!input.attachmentId) return [];
        // Only the uploader's own screenshot that isn't attached elsewhere yet (or is on a bug in this project).
        const a = await db.attachment.findFirst({
          where: { id: input.attachmentId, projectId },
        });
        if (!a || (a.entityType === null && a.createdById !== ctx.actor.id))
          throw new NotFoundException('Screenshot not found');
        if (!SCREENSHOT_TYPES.includes(a.contentType))
          throw new BadRequestException('Only PNG, JPEG or WebP screenshots can be analyzed');
        if (a.scanStatus === 'INFECTED')
          throw new BadRequestException('This file failed the malware scan');
        return [a.id];
      }
      case 'generate-ui-test': {
        const t = await db.testCase.findFirst({
          where: { id: input.testCaseId, projectId, deletedAt: null },
        });
        if (!t) throw new NotFoundException('Test case not found');
        if (
          input.environmentId &&
          !(await db.environment.findFirst({ where: { id: input.environmentId, projectId } }))
        )
          throw new NotFoundException('Environment not found');
        return [t.id];
      }
      case 'repair-ui-test':
      case 'analyze-failure': {
        const r = await db.automationResult.findFirst({
          where: { id: input.automationResultId, automationRun: { projectId } },
          select: { id: true, status: true, automationTestId: true },
        });
        if (!r) throw new NotFoundException('Result not found');
        if (r.status !== 'FAILED')
          throw new BadRequestException('Only failed results can be analysed or repaired');
        if (input.kind === 'repair-ui-test' && !r.automationTestId)
          throw new BadRequestException('Only Playwright tests can be repaired');
        return [r.id];
      }
      case 'write-report': {
        const r = await db.report.findFirst({
          where: { id: input.reportId, projectId },
          select: { id: true, status: true },
        });
        if (!r) throw new NotFoundException('Report not found');
        if (r.status !== 'READY') throw new BadRequestException('The report isn’t ready yet');
        return [r.id];
      }
    }
  }

  async list(projectId: string, filter: { sourceId?: string; limit: number }) {
    const rows = await this.prisma.client.agentJob.findMany({
      where: { projectId, ...(filter.sourceId ? { sourceIds: { has: filter.sourceId } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: filter.limit,
    });
    return rows.map(toEvent);
  }

  async listForOrg(organizationId: string, userId: string) {
    const since = new Date(Date.now() - 24 * 3600_000);
    const rows = await this.prisma.client.agentJob.findMany({
      where: {
        organizationId,
        OR: [
          { status: { in: ['QUEUED', 'RUNNING'] } },
          { createdById: userId, createdAt: { gte: since } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map(toEvent);
  }

  async get(projectId: string, id: string) {
    const job = await this.prisma.client.agentJob.findFirst({ where: { id, projectId } });
    if (!job) throw new NotFoundException('Job not found');
    return {
      ...toEvent(job),
      model: job.model,
      promptVersion: job.promptVersion,
      output: job.output,
    };
  }

  async cancel(ctx: ProjectCtx, id: string) {
    const job = await this.prisma.client.agentJob.findFirst({
      where: { id, projectId: ctx.projectId },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status !== 'QUEUED' && job.status !== 'RUNNING') return toEvent(job);
    if (job.createdById !== ctx.actor.id && !hasPermission(ctx.role, 'project:update'))
      throw new ForbiddenException('Only the requester or a QA Lead can cancel');
    const updated = await this.prisma.client.agentJob.update({
      where: { id },
      data: { status: 'CANCELLED', finishedAt: new Date(), progressMessage: null },
    });
    await this.queue.remove(id).catch(() => undefined); // removes it if still waiting
    await this.publish(updated);
    return toEvent(updated);
  }

  async publish(job: AgentJob) {
    await this.publisher
      .publish(agentJobChannel(job.organizationId), JSON.stringify(toEvent(job)))
      .catch(() => undefined);
  }

  /** Live job events for one organization (SSE). One Redis subscriber per open stream. */
  stream(organizationId: string): Observable<{ data: AgentJobEvent | { type: 'ping' } }> {
    return new Observable((sub) => {
      const redis = new IORedis(env().REDIS_URL);
      redis.on('error', () => undefined);
      // The client may disconnect before SUBSCRIBE completes; never let that reject unhandled
      // (an unhandled rejection would take the whole API process down).
      redis.subscribe(agentJobChannel(organizationId)).catch(() => undefined);
      redis.on('message', (_ch, msg) => sub.next({ data: JSON.parse(msg) as AgentJobEvent }));
      // Keep proxies from closing idle connections.
      const ping = setInterval(() => sub.next({ data: { type: 'ping' } }), 25_000);
      return () => {
        clearInterval(ping);
        redis.disconnect();
      };
    });
  }

  async onModuleDestroy() {
    await this.queue.close().catch(() => undefined);
    this.connection.disconnect();
    this.publisher.disconnect();
  }
}
