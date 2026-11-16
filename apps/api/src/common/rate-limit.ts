import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type IORedis from 'ioredis';

/**
 * Redis fixed-window rate limiting (one INCR + EXPIRE per request), shared by every API instance.
 * Stricter buckets for sign-in/sign-up (per IP, brute force) and AI endpoints (per user, cost).
 */
export interface RateRule {
  name: string;
  /** Requests allowed per window. */
  limit: number;
  windowSec: number;
  match: (req: Request) => boolean;
  /** 'ip' for unauthenticated endpoints; 'user' falls back to the IP when there is no session. */
  by: 'ip' | 'user';
}

const AUTH_PATHS =
  /^\/api\/auth\/(sign-in|sign-up|forget-password|reset-password|request-password-reset)/;
const AI_PATHS = /^\/v1\/projects\/[^/]+\/(agent-jobs|copilot)\/?$/;

export function defaultRules(limits: { api: number; auth: number; ai: number }): RateRule[] {
  return [
    {
      name: 'auth',
      limit: limits.auth,
      windowSec: 60,
      by: 'ip',
      match: (r) => r.method === 'POST' && AUTH_PATHS.test(r.path),
    },
    {
      name: 'ai',
      limit: limits.ai,
      windowSec: 60,
      by: 'user',
      match: (r) => r.method === 'POST' && AI_PATHS.test(r.path),
    },
    {
      name: 'api',
      limit: limits.api,
      windowSec: 60,
      by: 'user',
      match: (r) => r.path.startsWith('/v1/') || r.path.startsWith('/api/'),
    },
  ];
}

/** Session cookie (Better Auth) or bearer token; hashed so raw credentials never become Redis keys. */
function userKey(req: Request): string | null {
  const cookie = req.headers.cookie ?? '';
  const session = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/.exec(cookie)?.[1];
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
  const raw = session ?? bearer;
  if (!raw) return null;
  return `s:${createHash('sha256').update(raw).digest('base64url').slice(0, 22)}`;
}

export function rateLimit(redis: IORedis, rules: RateRule[], now = () => Date.now()) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Every matching rule applies (e.g. an AI call counts toward "ai" and "api").
    const applicable = rules.filter((r) => r.match(req));
    if (!applicable.length) return next();
    try {
      const t = Math.floor(now() / 1000);
      let tightest: { rule: RateRule; count: number; reset: number } | null = null;
      for (const rule of applicable) {
        const window = Math.floor(t / rule.windowSec);
        const who = (rule.by === 'user' && userKey(req)) || `ip:${req.ip ?? 'unknown'}`;
        const key = `qaforge:rl:${rule.name}:${who}:${window}`;
        const [[, count]] = (await redis
          .multi()
          .incr(key)
          .expire(key, rule.windowSec + 1)
          .exec()) as [[Error | null, number]];
        const reset = (window + 1) * rule.windowSec - t;
        const remaining = rule.limit - count;
        if (!tightest || remaining < tightest.rule.limit - tightest.count)
          tightest = { rule, count, reset };
      }
      const { rule, count, reset } = tightest!;
      res.setHeader('RateLimit-Limit', String(rule.limit));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, rule.limit - count)));
      res.setHeader('RateLimit-Reset', String(reset));
      if (count > rule.limit) {
        res.setHeader('Retry-After', String(reset));
        res.status(429).json({
          statusCode: 429,
          message:
            rule.name === 'auth'
              ? 'Too many attempts. Wait a minute and try again.'
              : 'Too many requests. Slow down and try again shortly.',
        });
        return;
      }
    } catch {
      // Fail open: Redis trouble must not take the API down.
    }
    next();
  };
}
