import type { Queue } from 'bullmq';
import { getPrisma, type Prisma } from '@qaforge/db';
import type { AiJobPayload } from '@qaforge/shared';
import { loadAiSettings, monthSpendUsd } from '../ai/context';

/**
 * Queue the Report Agent for a report that asked for a summary, when the organization has AI on,
 * configured, the agent enabled and budget left. Resolves false (no narrative) otherwise.
 */
export async function queueReportNarrative(
  reportId: string,
  aiQueue: Pick<Queue<AiJobPayload>, 'add'>,
): Promise<boolean> {
  const db = getPrisma();
  const report = await db.report.findUniqueOrThrow({
    where: { id: reportId },
    include: { project: { select: { id: true, organizationId: true, createdById: true } } },
  });
  const orgId = report.project.organizationId;
  const settings = await loadAiSettings(orgId);
  const configured =
    !!settings.apiKeyEnc ||
    !!process.env.ANTHROPIC_API_KEY ||
    process.env.QAFORGE_AI_PROVIDER === 'fake';
  if (settings.enabled === false || !configured || settings.disabledAgents?.includes('report'))
    return false;
  if (
    settings.monthlyBudgetUsd != null &&
    (await monthSpendUsd(orgId)) >= settings.monthlyBudgetUsd
  )
    return false;
  const job = await db.agentJob.create({
    data: {
      organizationId: orgId,
      projectId: report.projectId,
      agent: 'report',
      sourceType: 'report',
      sourceIds: [report.id],
      input: { kind: 'write-report', reportId: report.id } as Prisma.InputJsonValue,
      progressMessage: 'Queued',
      createdById: report.createdById ?? report.project.createdById,
    },
  });
  await db.report.update({ where: { id: report.id }, data: { aiJobId: job.id } });
  await aiQueue.add(
    'write-report',
    { jobId: job.id },
    { jobId: job.id, attempts: 2, backoff: { type: 'exponential', delay: 5000 } },
  );
  return true;
}
