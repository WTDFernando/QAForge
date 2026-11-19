import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUES, type AutomationJob } from '@qaforge/shared';
import { logger } from './logger';
import { processSystemJob } from './processors';
import { createAiProcessor } from './ai/processor';
import { scanningEnabled } from '@qaforge/db';
import { createScanProcessor } from './scan';
import { createAutomationProcessor } from './automation/processor';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const publisher = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379');

const automationQueue = new Queue<AutomationJob>(QUEUES.automation, { connection });
// Schedule tick: every minute, start runs for schedules that are due.
void automationQueue
  .upsertJobScheduler(
    'automation-schedule-tick',
    { every: 60_000 },
    { name: 'tick', data: { automationRunId: '' } },
  )
  .catch((err) => logger.error({ err }, 'could not register the schedule tick'));

const workers = [
  new Worker(QUEUES.system, processSystemJob, { connection, concurrency: 4 }),
  // AI calls are I/O bound; a few in parallel per worker process.
  new Worker(QUEUES.ai, createAiProcessor(publisher), {
    connection,
    concurrency: Number(process.env.AI_CONCURRENCY ?? 4),
  }),
  // Browser runs are CPU heavy: few at a time per worker process.
  new Worker(QUEUES.automation, createAutomationProcessor(automationQueue), {
    connection,
    concurrency: Number(process.env.AUTOMATION_CONCURRENCY ?? 2),
    lockDuration: 120_000,
  }),
  // Malware scanning only runs when ClamAV is configured (compose profile "scan").
  ...(scanningEnabled()
    ? [new Worker(QUEUES.scan, createScanProcessor(), { connection, concurrency: 2 })]
    : []),
];

for (const w of workers) {
  w.on('completed', (job) => logger.info({ queue: w.name, jobId: job.id }, 'job completed'));
  w.on('failed', (job, err) => logger.error({ queue: w.name, jobId: job?.id, err }, 'job failed'));
}
logger.info({ queues: workers.map((w) => w.name) }, 'worker started');

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  await Promise.all(workers.map((w) => w.close()));
  await automationQueue.close();
  await connection.quit();
  await publisher.quit();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
