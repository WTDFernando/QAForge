import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUES } from '@qaforge/shared';
import { logger } from './logger';
import { processSystemJob } from './processors';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const workers = [new Worker(QUEUES.system, processSystemJob, { connection, concurrency: 4 })];

for (const w of workers) {
  w.on('completed', (job) => logger.info({ queue: w.name, jobId: job.id }, 'job completed'));
  w.on('failed', (job, err) => logger.error({ queue: w.name, jobId: job?.id, err }, 'job failed'));
}
logger.info({ queues: workers.map((w) => w.name) }, 'worker started');

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
