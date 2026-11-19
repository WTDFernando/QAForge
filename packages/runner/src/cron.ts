import { CronExpressionParser } from 'cron-parser';

/** Next time a 5-field cron expression fires after `from`, in the given IANA timezone. */
export function nextCronRun(cron: string, timezone = 'UTC', from = new Date()): Date {
  return CronExpressionParser.parse(cron, { currentDate: from, tz: timezone }).next().toDate();
}

/** Throws a readable error for invalid expressions or timezones. */
export function validateCron(cron: string, timezone = 'UTC'): void {
  try {
    nextCronRun(cron, timezone);
  } catch (e) {
    throw new Error(`Invalid schedule: ${(e as Error).message}`);
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new Error(`Unknown timezone: ${timezone}`);
  }
}
