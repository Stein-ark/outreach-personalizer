/**
 * Request rate limits. Every route has a per IP limit, authenticated routes also have a per user limit,
 * and auth and AI routes have stricter ones. Counters are in memory (single instance, like the AI limiter).
 */
import type { Request, Response } from 'express';
import { ipKeyGenerator, rateLimit, type Options, type RateLimitInfo } from 'express-rate-limit';
import type { ErrorBody } from '@op/shared';

const MINUTE = 60_000;

function limiter(windowMs: number, limit: number, keyGenerator: Options['keyGenerator'], message: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator,
    handler: (req: Request, res: Response) => {
      const reset = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit?.resetTime?.getTime();
      const retryAfterSeconds = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 1000)) : Math.ceil(windowMs / 1000);
      const body: ErrorBody = { error: { code: 'RATE_LIMITED', message, retryAfterSeconds } };
      res.status(429).set('Retry-After', String(retryAfterSeconds)).json(body);
    },
  });
}

const byIp: Options['keyGenerator'] = (req) => ipKeyGenerator(req.ip ?? 'unknown');
const byUser: Options['keyGenerator'] = (req) => `u:${req.userId ?? 'anon'}`;
const byLoginEmail: Options['keyGenerator'] = (req) => {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return `e:${typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : 'none'}`;
};

export interface RateLimitSet {
  globalIp: ReturnType<typeof rateLimit>;
  login: ReturnType<typeof rateLimit>[];
  register: ReturnType<typeof rateLimit>;
  refresh: ReturnType<typeof rateLimit>;
  user: ReturnType<typeof rateLimit>;
  ai: ReturnType<typeof rateLimit>;
  collect: ReturnType<typeof rateLimit>;
}

export function createRateLimits(): RateLimitSet {
  return {
    globalIp: limiter(15 * MINUTE, 600, byIp, 'Too many requests. Slow down and try again shortly.'),
    // Per IP and per account, so neither one IP nor many IPs against one account can brute force a password.
    login: [
      limiter(15 * MINUTE, 10, byIp, 'Too many sign in attempts. Try again later.'),
      limiter(15 * MINUTE, 10, byLoginEmail, 'Too many sign in attempts. Try again later.'),
    ],
    register: limiter(60 * MINUTE, 5, byIp, 'Too many accounts created from this network. Try again later.'),
    refresh: limiter(15 * MINUTE, 60, byIp, 'Too many requests. Try again shortly.'),
    user: limiter(15 * MINUTE, 600, byUser, 'Too many requests. Slow down and try again shortly.'),
    ai: limiter(MINUTE, 12, byUser, 'You are drafting very quickly. Wait a moment and try again.'),
    // One request per page visited. Generous for normal browsing, but stops a runaway loop.
    collect: limiter(MINUTE, 60, byUser, 'Too many pages collected in a minute. Collection resumes shortly.'),
  };
}
