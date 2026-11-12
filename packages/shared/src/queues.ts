/** BullMQ queue contracts shared by the API (producer) and worker (consumer). */
export const QUEUES = {
  ai: 'ai-jobs',
  runs: 'test-runs',
  reports: 'reports',
  system: 'system',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobProgress {
  /** 0-100 */
  percent: number;
  message?: string;
}

export interface SystemPingJob {
  kind: 'ping';
  requestedAt: string;
}
