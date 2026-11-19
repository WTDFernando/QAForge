/** BullMQ queue contracts shared by the API (producer) and worker (consumer). */
export const QUEUES = {
  ai: 'ai-jobs',
  runs: 'test-runs',
  reports: 'reports',
  system: 'system',
  /** Malware scan of uploaded files (ClamAV). */
  scan: 'file-scan',
  /** Automation runs (API requests + Playwright tests) and the schedule tick. */
  automation: 'automation-runs',
} as const;

export interface ScanJob {
  attachmentId: string;
}
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

export interface AutomationJob {
  automationRunId: string;
}
