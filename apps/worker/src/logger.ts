import pino from 'pino';

export const logger = pino({
  name: 'worker',
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'development' || !process.env.NODE_ENV
      ? { target: 'pino-pretty', options: { singleLine: true } }
      : undefined,
});
