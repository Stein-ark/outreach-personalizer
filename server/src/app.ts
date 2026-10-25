/**
 * Express app factory. Order matters: security headers, HTTPS check, origin allowlist, body limit,
 * request logging, per IP limit, routes, then the 404 and central error handlers.
 */
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { API_PREFIX, type ErrorBody } from '@op/shared';
import { httpLogger } from './lib/logger.js';
import { AppError } from './lib/errors.js';
import { ValidationError } from './lib/validate.js';
import { requireAuth } from './auth/middleware.js';
import { authRoutes } from './routes/auth.js';
import { accountRoutes } from './routes/account.js';
import { aiRoutes } from './routes/ai.js';
import { prospectRoutes } from './routes/prospects.js';
import type { AppContext } from './context.js';

export const SERVER_VERSION = '0.1.0';

export function createApp(ctx: AppContext): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', ctx.env.TRUST_PROXY_HOPS);

  app.use(helmet());

  if (ctx.env.NODE_ENV === 'production') {
    app.use((req, _res, next) => {
      if (!req.secure) throw new AppError(400, 'HTTPS_REQUIRED', 'HTTPS is required.');
      next();
    });
  }

  // Browsers send an Origin header. Only the extension's origin is allowed, anything else is refused outright.
  const allowed = new Set(ctx.env.CORS_ORIGINS);
  app.use((req, _res, next) => {
    const origin = req.get('origin');
    if (origin && !allowed.has(origin)) throw new AppError(403, 'FORBIDDEN', 'Origin not allowed.');
    next();
  });
  app.use(
    cors({
      origin: [...allowed],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      exposedHeaders: ['Content-Disposition', 'Retry-After'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '48kb' }));
  app.use(httpLogger(ctx.logger));
  app.use(ctx.limits.globalIp);

  const api = Router();
  api.get('/health', (_req, res) => {
    res.json({ ok: true, version: SERVER_VERSION });
  });
  api.use('/auth', authRoutes(ctx));
  api.use(requireAuth(ctx.tokens, ctx.sessions), ctx.limits.user);
  api.use(accountRoutes());
  api.use(aiRoutes(ctx));
  api.use(prospectRoutes());
  app.use(API_PREFIX, api);

  app.use(() => {
    throw new AppError(404, 'NOT_FOUND', 'Not found.');
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const send = (status: number, error: ErrorBody['error']) => {
      if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
      res.status(status).json({ error } satisfies ErrorBody);
    };
    if (err instanceof ValidationError) {
      return send(400, { code: 'VALIDATION', message: 'Some fields are invalid.', issues: err.issues });
    }
    if (err instanceof AppError) {
      return send(err.status, {
        code: err.code,
        message: err.message,
        ...(err.retryAfterSeconds ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
      });
    }
    const type = (err as { type?: string }).type;
    if (type === 'entity.too.large') return send(413, { code: 'VALIDATION', message: 'Request is too large.' });
    if (type === 'entity.parse.failed') return send(400, { code: 'VALIDATION', message: 'Request body is not valid JSON.' });

    // Unknown errors: log the error class and stack frames only (messages can echo user data), answer generically.
    const e = err instanceof Error ? err : new Error('non-error thrown');
    ctx.logger.error({ err: { name: e.name, frames: e.stack?.split('\n').slice(1, 8).join('\n') } }, 'unhandled error');
    return send(500, { code: 'INTERNAL', message: 'Something went wrong on our side.' });
  });

  return app;
}
