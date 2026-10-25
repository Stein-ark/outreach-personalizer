/**
 * Bearer token authentication. Accepts only "Authorization: Bearer <jwt>", verifies it, and checks that the
 * login it belongs to has not been logged out or revoked, so logout takes effect immediately.
 */
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';
import { isDbConnected, isDbUnavailable } from '../lib/dbStatus.js';
import { AppError, unauthenticated } from '../lib/errors.js';
import type { SessionService } from './sessions.js';
import type { TokenService } from './tokens.js';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

/**
 * If the database cannot be reached, a validly signed, unexpired access token is accepted without the revocation check,
 * so features that do not need the database (reading and extracting a page) keep working. The token lives 15 minutes.
 */
export function requireAuth(tokens: TokenService, sessions: SessionService, logger: Logger) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) throw unauthenticated();
    const claims = await tokens.verifyAccess(token);
    if (!claims) throw new AppError(401, 'SESSION_EXPIRED', 'Your session expired.');
    let active = true;
    try {
      if (isDbConnected()) active = await sessions.isFamilyActive(claims.familyId);
      else logger.warn({ event: 'auth_degraded' }, 'database unavailable, accepting signed access token without revocation check');
    } catch (err) {
      if (!isDbUnavailable(err)) throw err;
      logger.warn({ event: 'auth_degraded' }, 'database unavailable, accepting signed access token without revocation check');
    }
    if (!active) throw unauthenticated('You were signed out. Please sign in again.');
    req.userId = claims.userId;
    next();
  };
}

/** The authenticated user id. Only call in routes mounted behind requireAuth. */
export function userIdOf(req: Request): string {
  if (!req.userId) throw unauthenticated();
  return req.userId;
}
