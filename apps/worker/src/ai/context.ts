import type IORedis from 'ioredis';
import {
  AnthropicProvider,
  costUsd,
  FakeProvider,
  secretValues,
  type ModelCall,
  type ModelProvider,
} from '@qaforge/ai';
import {
  createStorage,
  decryptJson,
  getPrisma,
  Prisma,
  type AgentJob,
  type Attachment,
} from '@qaforge/db';
import {
  agentJobChannel,
  DEFAULT_AI_MODEL,
  type AgentId,
  type AgentJobEvent,
  type StartAgentJobInput,
} from '@qaforge/shared';
import { fakeResponder } from './fake-responder';

export const prisma = () => getPrisma();

/** Organization AI settings as stored in organization.settings.ai. */
export interface StoredAiSettings {
  /** Master switch (default on). */
  enabled?: boolean;
  model?: string;
  apiKeyEnc?: string | null;
  monthlyBudgetUsd?: number | null;
  disabledAgents?: AgentId[];
}

/** Errors that should fail the job immediately (no retries) with a message for the user. */
export class JobError extends Error {}

/** The file is still being scanned for malware: retry later. */
export class ScanPendingError extends Error {
  constructor() {
    super('Waiting for the malware scan of the file');
  }
}

/** Read an uploaded file for an agent, honouring the malware scan (files are unusable until clean). */
export async function readScanned(a: Pick<Attachment, 'storageKey' | 'scanStatus'>) {
  if (a.scanStatus === 'INFECTED') throw new JobError('The file failed the malware scan');
  if (a.scanStatus === 'FAILED') throw new JobError('The file could not be scanned for malware');
  if (a.scanStatus === 'PENDING') throw new ScanPendingError();
  return createStorage().read(a.storageKey);
}

export async function loadAiSettings(organizationId: string) {
  const org = await prisma().organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { settings: true },
  });
  return ((org.settings as { ai?: StoredAiSettings } | null)?.ai ?? {}) as StoredAiSettings;
}

export function createProvider(settings: StoredAiSettings): {
  provider: ModelProvider;
  model: string;
} {
  if (process.env.QAFORGE_AI_PROVIDER === 'fake')
    return { provider: new FakeProvider(fakeResponder), model: 'fake-model' };
  const apiKey = settings.apiKeyEnc
    ? decryptJson<string>(settings.apiKeyEnc)
    : process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    throw new JobError(
      'No Anthropic API key is configured. An Admin can add one in Settings > AI.',
    );
  return {
    provider: new AnthropicProvider(apiKey),
    model: settings.model ?? process.env.AI_DEFAULT_MODEL ?? DEFAULT_AI_MODEL,
  };
}

export async function monthSpendUsd(organizationId: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const agg = await prisma().aiUsage.aggregate({
    where: { organizationId, createdAt: { gte: start } },
    _sum: { costUsd: true },
  });
  return Number(agg._sum.costUsd ?? 0);
}

export async function assertBudget(organizationId: string, settings: StoredAiSettings) {
  if (settings.monthlyBudgetUsd == null) return;
  const spent = await monthSpendUsd(organizationId);
  if (spent >= settings.monthlyBudgetUsd) {
    throw new JobError(
      `This month's AI budget ($${settings.monthlyBudgetUsd.toFixed(2)}) has been reached. An Admin can raise it in Settings > AI.`,
    );
  }
}

export async function recordUsage(job: AgentJob, provider: ModelProvider, call: ModelCall) {
  await prisma().aiUsage.create({
    data: {
      organizationId: job.organizationId,
      projectId: job.projectId,
      agentJobId: job.id,
      agent: job.agent,
      provider: provider.id,
      model: call.model,
      inputTokens: call.usage.inputTokens,
      outputTokens: call.usage.outputTokens,
      cacheReadTokens: call.usage.cacheReadTokens,
      cacheWriteTokens: call.usage.cacheWriteTokens,
      costUsd: new Prisma.Decimal(provider.id === 'fake' ? 0 : costUsd(call.model, call.usage)),
      createdById: job.createdById,
    },
  });
}

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

/** Update the job row and push the change to subscribers (API SSE -> browser). */
export async function updateJob(redis: IORedis, id: string, data: Prisma.AgentJobUpdateInput) {
  const job = await prisma().agentJob.update({ where: { id }, data });
  await redis.publish(agentJobChannel(job.organizationId), JSON.stringify(toEvent(job)));
  return job;
}

/** Audit entries for AI-made changes: actor is the agent; the requesting user and job are in metadata. */
export async function auditAi(
  tx: Prisma.TransactionClient,
  job: AgentJob,
  entry: {
    entityType: string;
    entityId: string;
    action: string;
    after?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.auditLog.create({
    data: {
      organizationId: job.organizationId,
      projectId: job.projectId,
      actorType: 'AI_AGENT',
      actorId: null,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      changes: entry.after
        ? (Object.fromEntries(
            Object.entries(entry.after).map(([k, v]) => [k, { from: null, to: v }]),
          ) as Prisma.InputJsonValue)
        : undefined,
      metadata: {
        agent: job.agent,
        jobId: job.id,
        requestedBy: job.createdById,
        model: job.model,
        ...entry.metadata,
      } as Prisma.InputJsonValue,
    },
  });
}

/**
 * Everything that must never reach a model: the project's environment secrets and the org API key.
 * Undecryptable values are skipped (they can't leak in clear text anyway).
 */
export async function secretsFor(projectId: string | null, settings: StoredAiSettings) {
  const out: string[] = [];
  const tryDecrypt = (enc: string) => {
    try {
      out.push(...secretValues(decryptJson<unknown>(enc)));
    } catch {
      /* ignore */
    }
  };
  if (settings.apiKeyEnc) tryDecrypt(settings.apiKeyEnc);
  if (projectId) {
    const envs = await prisma().environment.findMany({
      where: { projectId, secrets: { not: null } },
      select: { secrets: true },
    });
    for (const e of envs) tryDecrypt(e.secrets!);
  }
  if (process.env.ANTHROPIC_API_KEY) out.push(process.env.ANTHROPIC_API_KEY);
  return out;
}
