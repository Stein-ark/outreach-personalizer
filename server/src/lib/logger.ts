/**
 * Structured logging. Request logs carry only method, path (query string removed), status and timing.
 * Bodies, headers, tokens, page text, prospect details and drafts are never logged.
 */
import { pino, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: undefined,
    // Defence in depth, in case an object containing these keys is ever logged by mistake.
    redact: {
      paths: ['authorization', 'password', 'refreshToken', 'accessToken', 'text', 'body', 'subject', '*.authorization', '*.password', '*.text', '*.body'],
      censor: '[redacted]',
    },
  });
}

export function httpLogger(logger: Logger) {
  return pinoHttp({
    logger,
    quietReqLogger: true,
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: {
      req: (req: IncomingMessage) => ({ method: req.method, path: (req.url ?? '').split('?')[0] }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },
    customSuccessObject: (req, res, val: Record<string, unknown>) => ({
      ...val,
      userId: (req as IncomingMessage & { userId?: string }).userId,
      statusCode: res.statusCode,
    }),
  });
}
