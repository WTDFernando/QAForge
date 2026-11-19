import { describe, expect, it } from 'vitest';
import { nextCronRun, validateCron } from './cron';

describe('cron', () => {
  it('computes the next run in a timezone', () => {
    const from = new Date('2026-11-19T10:00:00Z');
    expect(nextCronRun('*/15 * * * *', 'UTC', from).toISOString()).toBe('2026-11-19T10:15:00.000Z');
    // 02:00 in Colombo (UTC+5:30) is 20:30 UTC the day before.
    expect(nextCronRun('0 2 * * *', 'Asia/Colombo', from).toISOString()).toBe(
      '2026-11-19T20:30:00.000Z',
    );
    expect(nextCronRun('0 9 * * 1-5', 'UTC', new Date('2026-11-21T12:00:00Z')).toISOString()).toBe(
      '2026-11-23T09:00:00.000Z',
    );
  });
  it('rejects bad expressions and timezones', () => {
    expect(() => validateCron('61 * * * *')).toThrow(/Invalid schedule/);
    expect(() => validateCron('0 2 * * *', 'Mars/Base')).toThrow(
      /Invalid schedule|Unknown timezone/,
    );
    expect(() => validateCron('0 2 * * *', 'Europe/London')).not.toThrow();
  });
});
