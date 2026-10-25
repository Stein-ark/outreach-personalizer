/**
 * Typed application errors. Route handlers throw these and the central error handler turns them into the
 * shared ErrorBody shape, so clients map errors by code and never see stack traces.
 */
import type { ErrorCode } from '@op/shared';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export const unauthenticated = (message = 'Please sign in again.') => new AppError(401, 'UNAUTHENTICATED', message);
export const notFound = (what = 'Item') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
export const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
