import type { Job } from 'bullmq';
import type { SystemPingJob } from '@qaforge/shared';

/**
 * Job processors, keyed by queue. AI agents, the Playwright runner and the
 * report builder register here in later phases.
 */
export async function processSystemJob(job: Job<SystemPingJob>) {
  if (job.data.kind === 'ping') {
    await job.updateProgress({ percent: 100, message: 'pong' });
    return { pong: true, latencyMs: Date.now() - new Date(job.data.requestedAt).getTime() };
  }
  throw new Error(`Unknown system job kind: ${(job.data as { kind: string }).kind}`);
}
