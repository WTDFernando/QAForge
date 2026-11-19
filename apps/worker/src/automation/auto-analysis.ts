import type { Queue } from 'bullmq';
import { getPrisma, type AutomationRun, type Prisma } from '@qaforge/db';
import type { AiJobPayload } from '@qaforge/shared';
import { loadAiSettings, monthSpendUsd } from '../ai/context';

const MAX_PER_RUN = 10;

/**
 * After a run with failures, queue the Failure Analysis Agent for each failed result (up to 10),
 * but only when the organization has AI on, configured, the agent enabled and budget left.
 */
export async function queueFailureAnalysis(
  run: AutomationRun,
  aiQueue: Pick<Queue<AiJobPayload>, 'add'>,
) {
  if (run.status !== 'FAILED') return [];
  const db = getPrisma();
  const project = await db.project.findUniqueOrThrow({ where: { id: run.projectId } });
  const settings = await loadAiSettings(project.organizationId);
  const configured =
    !!settings.apiKeyEnc ||
    !!process.env.ANTHROPIC_API_KEY ||
    process.env.QAFORGE_AI_PROVIDER === 'fake';
  if (
    settings.enabled === false ||
    !configured ||
    settings.disabledAgents?.includes('failure-analysis')
  )
    return [];
  if (
    settings.monthlyBudgetUsd != null &&
    (await monthSpendUsd(project.organizationId)) >= settings.monthlyBudgetUsd
  )
    return [];
  const failed = await db.automationResult.findMany({
    where: { automationRunId: run.id, status: 'FAILED', failureClass: null },
    orderBy: { position: 'asc' },
    take: MAX_PER_RUN,
    select: { id: true },
  });
  const ids: string[] = [];
  for (const r of failed) {
    const job = await db.agentJob.create({
      data: {
        organizationId: project.organizationId,
        projectId: project.id,
        agent: 'failure-analysis',
        sourceType: 'automation_result',
        sourceIds: [r.id],
        input: { kind: 'analyze-failure', automationResultId: r.id } as Prisma.InputJsonValue,
        progressMessage: 'Queued',
        createdById: run.createdById ?? project.createdById,
      },
    });
    await aiQueue.add(
      'analyze-failure',
      { jobId: job.id },
      {
        jobId: job.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
    ids.push(job.id);
  }
  return ids;
}
