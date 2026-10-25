/**
 * Typed API client. Every response is validated against the shared schema before the UI sees it.
 * Authenticated calls refresh the access token once on a 401 and retry. Safe GETs retry once on network trouble.
 */
import type { z } from 'zod';
import {
  AuthResponse,
  CollectResponse,
  DeletedCount,
  DraftResponse,
  ExtractResponse,
  Prospect,
  ProspectList,
  Settings,
  VoiceSample,
  VoiceSampleList,
  type CollectRequest,
  type Credentials,
  type DraftRequest,
  type ExtractRequest,
  type LoginRequest,
  type ProspectFilter,
  type ProspectPatch,
} from '@op/shared';
import { AI_REQUEST_TIMEOUT_MS } from '../config';
import { REFRESH_KEY, StoredRefresh, clearSession, getAccessToken, refreshTokens, saveSession } from './auth';
import { ApiError, httpRequest, type HttpOptions } from './http';
import { getStored } from './storage';

const RETRYABLE = new Set(['UNREACHABLE', 'TIMEOUT']);

async function authed(path: string, opts: HttpOptions = {}): Promise<Response> {
  const token = await getAccessToken();
  if (!token) throw new ApiError('SESSION_EXPIRED', 'Your session expired. Sign in again.', 401);
  const send = (t: string) => httpRequest(path, { ...opts, token: t });
  const isGet = (opts.method ?? 'GET') === 'GET';
  try {
    return await send(token);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.status === 401 && (err.code === 'SESSION_EXPIRED' || err.code === 'UNAUTHENTICATED')) {
      const next = await refreshTokens(token);
      if (!next) throw new ApiError('SESSION_EXPIRED', 'Your session expired. Sign in again.', 401);
      return send(next);
    }
    if (isGet && RETRYABLE.has(err.code)) {
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 600));
      return send(token);
    }
    throw err;
  }
}

async function json<S extends z.ZodType>(schema: S, res: Response): Promise<z.output<S>> {
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ApiError('BAD_RESPONSE', 'The server sent an unexpected response.');
  return parsed.data;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== '').map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : '';
};

export const api = {
  async register(body: Credentials) {
    const auth = await json(AuthResponse, await httpRequest('/auth/register', { method: 'POST', body }));
    await saveSession(auth);
    return auth.user;
  },
  async login(body: LoginRequest) {
    const auth = await json(AuthResponse, await httpRequest('/auth/login', { method: 'POST', body }));
    await saveSession(auth);
    return auth.user;
  },
  async logout() {
    const stored = await getStored('local', REFRESH_KEY, StoredRefresh);
    await clearSession();
    // Best effort: local sign out always succeeds, the server revokes the session when reachable.
    if (stored) await httpRequest('/auth/logout', { method: 'POST', body: { refreshToken: stored.refreshToken } }).catch(() => undefined);
  },
  async deleteAccount(password: string) {
    await authed('/account', { method: 'DELETE', body: { password } });
    await clearSession();
  },

  getSettings: async () => json(Settings, await authed('/settings')),
  putSettings: async (body: Settings) => json(Settings, await authed('/settings', { method: 'PUT', body })),

  listVoiceSamples: async () => (await json(VoiceSampleList, await authed('/voice-samples'))).items,
  addVoiceSample: async (text: string) => json(VoiceSample, await authed('/voice-samples', { method: 'POST', body: { text } })),
  deleteVoiceSample: async (id: string) => void (await authed(`/voice-samples/${encodeURIComponent(id)}`, { method: 'DELETE' })),

  extract: async (body: ExtractRequest) => json(ExtractResponse, await authed('/extract', { method: 'POST', body, timeoutMs: AI_REQUEST_TIMEOUT_MS })),
  draft: async (body: DraftRequest) => json(DraftResponse, await authed('/draft', { method: 'POST', body, timeoutMs: AI_REQUEST_TIMEOUT_MS })),

  listProspects: async (params: ProspectFilter & { cursor?: string; limit?: number }) =>
    json(ProspectList, await authed(`/prospects${qs(params)}`)),
  getProspect: async (id: string) => json(Prospect, await authed(`/prospects/${encodeURIComponent(id)}`)),
  patchProspect: async (id: string, body: ProspectPatch) =>
    json(Prospect, await authed(`/prospects/${encodeURIComponent(id)}`, { method: 'PATCH', body })),
  deleteProspect: async (id: string) => void (await authed(`/prospects/${encodeURIComponent(id)}`, { method: 'DELETE' })),
  collect: async (body: CollectRequest) => json(CollectResponse, await authed('/prospects/collect', { method: 'POST', body })),
  deleteAllProspects: async () => json(DeletedCount, await authed('/prospects?confirm=all', { method: 'DELETE' })),

  /** Authenticated download: fetch the file as a blob and hand it to the browser via an object URL. */
  async exportProspects(filter: ProspectFilter): Promise<void> {
    const res = await authed(`/prospects/export${qs(filter)}`, { timeoutMs: 60_000 });
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'prospects.xlsx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};
