import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { RefreshSession } from '../src/db/models.js';
import { SessionService } from '../src/auth/sessions.js';
import { TokenService } from '../src/auth/tokens.js';
import { useMemoryMongo } from './helpers.js';

useMemoryMongo();

const tokens = new TokenService('s'.repeat(40), 900);
const sessions = new SessionService(tokens, 30);
const userId = new Types.ObjectId().toHexString();

describe('refresh token rotation', () => {
  it('issues a working access token and stores only a hash of the refresh token', async () => {
    const t = await sessions.start(userId);
    expect(await tokens.verifyAccess(t.accessToken)).toMatchObject({ userId });
    const stored = await RefreshSession.findOne().lean();
    expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.tokenHash).not.toContain(t.refreshToken);
  });

  it('rotates: the new token works and the old one is consumed', async () => {
    const first = await sessions.start(userId);
    const r1 = await sessions.refresh(first.refreshToken);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.tokens.refreshToken).not.toBe(first.refreshToken);
    const r2 = await sessions.refresh(r1.tokens.refreshToken);
    expect(r2.ok).toBe(true);
  });

  it('detects reuse of a consumed token and revokes the whole family', async () => {
    const first = await sessions.start(userId);
    const rotated = await sessions.refresh(first.refreshToken);
    if (!rotated.ok) throw new Error('rotation failed');
    const claims = await tokens.verifyAccess(rotated.tokens.accessToken);

    expect(await sessions.refresh(first.refreshToken)).toEqual({ ok: false, reason: 'reused' });
    // The attacker's replay also kills the legitimate, newer token.
    expect(await sessions.refresh(rotated.tokens.refreshToken)).toEqual({ ok: false, reason: 'reused' });
    expect(await sessions.isFamilyActive(claims!.familyId)).toBe(false);
  });

  it('lets only one of two concurrent refreshes with the same token win', async () => {
    const first = await sessions.start(userId);
    const results = await Promise.all([sessions.refresh(first.refreshToken), sessions.refresh(first.refreshToken)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('rejects unknown and expired tokens', async () => {
    expect(await sessions.refresh('nope'.repeat(10))).toEqual({ ok: false, reason: 'unknown' });
    const t = await sessions.start(userId);
    await RefreshSession.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await sessions.refresh(t.refreshToken)).toEqual({ ok: false, reason: 'expired' });
  });

  it('logout revokes the family so its access tokens stop working', async () => {
    const t = await sessions.start(userId);
    const claims = await tokens.verifyAccess(t.accessToken);
    await sessions.revokeByToken(t.refreshToken);
    expect(await sessions.isFamilyActive(claims!.familyId)).toBe(false);
  });

  it('rejects tampered access tokens', async () => {
    const t = await sessions.start(userId);
    const other = new TokenService('o'.repeat(40), 900);
    expect(await other.verifyAccess(t.accessToken)).toBeNull();
    expect(await tokens.verifyAccess(`${t.accessToken}x`)).toBeNull();
  });
});
