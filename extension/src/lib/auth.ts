/**
 * Token storage and refresh. The access token lives in session storage (memory only), the refresh token in
 * local storage. Refreshes are serialized with a Web Lock shared by every extension page, because two concurrent
 * refreshes with the same token would trip the server's reuse detection and sign the user out.
 */
import { z } from 'zod';
import { AuthResponse } from '@op/shared';
import { getStored, removeStored, setStored } from './storage';
import { ApiError, httpRequest } from './http';

export const ACCESS_KEY = 'auth.access';
export const REFRESH_KEY = 'auth.refresh';

export const StoredAccess = z.object({ token: z.string(), expiresAt: z.number() });
export const StoredRefresh = z.object({ refreshToken: z.string(), user: z.object({ id: z.string(), email: z.string() }) });
export type SignedInUser = z.infer<typeof StoredRefresh>['user'];

/** Refresh this long before expiry so a request never leaves with a token about to lapse. */
const EARLY_REFRESH_MS = 30_000;

export async function saveSession(auth: AuthResponse): Promise<void> {
  await Promise.all([
    setStored('session', ACCESS_KEY, { token: auth.accessToken, expiresAt: auth.accessTokenExpiresAt }),
    setStored('local', REFRESH_KEY, { refreshToken: auth.refreshToken, user: auth.user }),
  ]);
}

export async function clearSession(): Promise<void> {
  await Promise.all([removeStored('session', ACCESS_KEY), removeStored('local', REFRESH_KEY)]);
}

const fresh = (a: z.infer<typeof StoredAccess> | null) => a !== null && a.expiresAt - Date.now() > EARLY_REFRESH_MS;

/** A usable access token, refreshing if needed. Null means the user must sign in. */
export async function getAccessToken(): Promise<string | null> {
  const access = await getStored('session', ACCESS_KEY, StoredAccess);
  if (fresh(access)) return access!.token;
  return refreshTokens(access?.token ?? null);
}

/**
 * Exchanges the refresh token for a new pair. `rejected` is the access token the server just refused, so a
 * refresh that another page already completed is reused instead of repeated.
 */
export function refreshTokens(rejected: string | null): Promise<string | null> {
  return navigator.locks.request('op-auth-refresh', async () => {
    const access = await getStored('session', ACCESS_KEY, StoredAccess);
    if (fresh(access) && access!.token !== rejected) return access!.token;
    const stored = await getStored('local', REFRESH_KEY, StoredRefresh);
    if (!stored) return null;
    try {
      const res = await httpRequest('/auth/refresh', { method: 'POST', body: { refreshToken: stored.refreshToken } });
      const auth = AuthResponse.parse(await res.json());
      await saveSession(auth);
      return auth.accessToken;
    } catch (err) {
      // Only a definite rejection signs the user out. Network trouble keeps the session for a later retry.
      if (err instanceof ApiError && err.status === 401) {
        await clearSession();
        return null;
      }
      throw err;
    }
  });
}
