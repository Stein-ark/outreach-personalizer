/**
 * Low level fetch wrapper: timeouts, offline detection and mapping every failure to an ApiError with a code
 * the UI can switch on. Knows nothing about tokens.
 */
import { API_PREFIX, ErrorBody, type ErrorCode } from '@op/shared';
import { API_BASE_URL, REQUEST_TIMEOUT_MS } from '../config';

export type ClientErrorCode = ErrorCode | 'OFFLINE' | 'UNREACHABLE' | 'TIMEOUT' | 'BAD_RESPONSE';

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status = 0,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export interface HttpOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  timeoutMs?: number;
}

export async function httpRequest(path: string, opts: HttpOptions = {}): Promise<Response> {
  if (!navigator.onLine) throw new ApiError('OFFLINE', 'You are offline. Reconnect and try again.');
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new ApiError('TIMEOUT', 'The server took too long to answer. Try again.');
    }
    if (!navigator.onLine) throw new ApiError('OFFLINE', 'You are offline. Reconnect and try again.');
    throw new ApiError('UNREACHABLE', 'Cannot reach the server. Check your connection or try again later.');
  }

  if (res.ok) return res;
  const parsed = ErrorBody.safeParse(await res.json().catch(() => null));
  if (parsed.success) {
    const e = parsed.data.error;
    throw new ApiError(e.code, e.message, res.status, e.retryAfterSeconds);
  }
  if (res.status >= 500) throw new ApiError('UNREACHABLE', 'The server is having trouble. Try again shortly.', res.status);
  throw new ApiError('BAD_RESPONSE', `Unexpected response from the server (${res.status}).`, res.status);
}
