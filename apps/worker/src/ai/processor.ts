import { UnrecoverableError, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { ConfigError, OutputError, RefusalError } from '@qaforge/ai';
import type { AiJobPayload, StartAgentJobInput } from '@qaforge/shared';
import { AGENT_FOR_KIND } from '@qaforge/shared';
import { logger } from '../logger';
import {
  assertBudget,
  createProvider,
  JobError,
  loadAiSettings,
  prisma,
  updateJob,
} from './context';
import { handle } from './handlers';

/** Turn any failure into a message a QA engineer can act on. */
export function friendlyError(e: unknown): { message: string; retry: boolean } {
  if (e instanceof JobError || e instanceof ConfigError)
    return { message: e.message, retry: false };
  if (e instanceof RefusalError)
    return {
      message: `The AI model declined this request${e.category ? ` (${e.category})` : ''}. Try rephrasing the source or splitting it.`,
      retry: false,
    };
  if (e instanceof OutputError)
    return {
      message: `${e.message}. Try again; if it keeps failing, split the input into smaller parts.`,
      retry: true,
    };
  const status = (e as { status?: number }).status;
  if (
    status === 429 ||
    (status && status >= 500) ||
    (e as { name?: string }).name === 'APIConnectionError'
  ) {
    return { message: 'The AI service is busy or unreachable. Retrying…', retry: true };
  }
  return { message: 'Unexpected error while running the agent.', retry: false };
}

export function createAiProcessor(redis: IORedis) {
  return async function processAiJob(bull: Job<AiJobPayload>) {
    const { jobId } = bull.data;
    let job = await prisma().agentJob.findUnique({ where: { id: jobId } });
    if (!job || job.status === 'CANCELLED' || job.status === 'SUCCEEDED') return { skipped: true };
    const input = job.input as StartAgentJobInput;
    const controller = new AbortController();
    try {
      const settings = await loadAiSettings(job.organizationId);
      if (settings.disabledAgents?.includes(AGENT_FOR_KIND[input.kind]))
        throw new JobError('This agent was disabled by an Admin.');
      await assertBudget(job.organizationId, settings);
      const { provider, model } = createProvider(settings);
      job = await updateJob(redis, job.id, {
        status: 'RUNNING',
        startedAt: new Date(),
        progress: 5,
        progressMessage: 'Starting',
        model,
        error: null,
      });

      let last = 0;
      const result = await handle({
        job,
        provider,
        model,
        signal: controller.signal,
        progress: (p, expected, message) => {
          const now = Date.now();
          if (now - last < 750) return;
          last = now;
          const pct = Math.min(90, 10 + Math.round((p.outputChars / Math.max(expected, 1)) * 80));
          void updateJob(redis, job!.id, { progress: pct, progressMessage: message }).catch(
            () => undefined,
          );
        },
      });
      const current = await prisma().agentJob.findUnique({
        where: { id: job.id },
        select: { status: true },
      });
      if (current?.status === 'CANCELLED') return { cancelled: true };
      await updateJob(redis, job.id, {
        status: 'SUCCEEDED',
        progress: 100,
        progressMessage: 'Done',
        summary: result.summary,
        output: result.output as object,
        finishedAt: new Date(),
      });
      logger.info({ jobId, kind: input.kind, summary: result.summary }, 'agent job succeeded');
      return { ok: true };
    } catch (e) {
      const { message, retry } = friendlyError(e);
      const final = !retry || bull.attemptsMade + 1 >= (bull.opts.attempts ?? 1);
      logger.error({ jobId, err: e, retry }, 'agent job failed');
      await updateJob(
        redis,
        jobId,
        final
          ? { status: 'FAILED', error: message, finishedAt: new Date(), progressMessage: null }
          : { progressMessage: message },
      );
      if (input.kind === 'analyze-source' && final) {
        await prisma().requirementSource.updateMany({
          where: { id: input.sourceId, status: 'PROCESSING' },
          data: { status: 'FAILED' },
        });
      }
      if (!retry) throw new UnrecoverableError(message);
      throw e;
    }
  };
}
