import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { processSystemJob } from './processors';

const fakeJob = (data: unknown) =>
  ({ data, updateProgress: vi.fn().mockResolvedValue(undefined) }) as unknown as Job<never>;

describe('system processor', () => {
  it('answers ping', async () => {
    const job = fakeJob({ kind: 'ping', requestedAt: new Date().toISOString() });
    const res = await processSystemJob(job);
    expect(res.pong).toBe(true);
    expect(job.updateProgress).toHaveBeenCalledWith({ percent: 100, message: 'pong' });
  });
  it('rejects unknown jobs', async () => {
    await expect(processSystemJob(fakeJob({ kind: 'nope' }))).rejects.toThrow('Unknown');
  });
});
