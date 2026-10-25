/**
 * Refresh token rotation with reuse detection.
 *
 * Each refresh consumes the presented token (marks it revoked) and issues a new one in the same family.
 * If a token that was already consumed is presented again, someone holds a copy of an old token,
 * so the whole family is revoked and both the attacker and the real user must sign in again.
 */
import { Types } from 'mongoose';
import { RefreshSession } from '../db/models.js';
import { hashToken, newFamilyId, newRefreshToken, type TokenService } from './tokens.js';

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
}

export type RefreshResult =
  | { ok: true; userId: string; tokens: IssuedTokens }
  | { ok: false; reason: 'unknown' | 'expired' | 'reused' };

export class SessionService {
  constructor(
    private readonly tokens: TokenService,
    private readonly refreshTtlDays: number,
  ) {}

  private expiry(): Date {
    return new Date(Date.now() + this.refreshTtlDays * 86_400_000);
  }

  private async issue(userId: string, familyId: string): Promise<IssuedTokens> {
    const refreshToken = newRefreshToken();
    await RefreshSession.create({
      userId: new Types.ObjectId(userId),
      familyId,
      tokenHash: hashToken(refreshToken),
      expiresAt: this.expiry(),
    });
    const access = await this.tokens.signAccess({ userId, familyId });
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken };
  }

  /** Starts a new login (new family). */
  start(userId: string): Promise<IssuedTokens> {
    return this.issue(userId, newFamilyId());
  }

  async refresh(presented: string): Promise<RefreshResult> {
    const tokenHash = hashToken(presented);
    // Atomically consume the token: only one concurrent request can flip revokedAt from null.
    const consumed = await RefreshSession.findOneAndUpdate(
      { tokenHash, revokedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { revokedAt: new Date() } },
    ).lean();
    if (consumed) {
      return { ok: true, userId: String(consumed.userId), tokens: await this.issue(String(consumed.userId), consumed.familyId) };
    }

    const existing = await RefreshSession.findOne({ tokenHash }).lean();
    if (!existing) return { ok: false, reason: 'unknown' };
    if (existing.revokedAt) {
      await this.revokeFamily(existing.familyId);
      return { ok: false, reason: 'reused' };
    }
    return { ok: false, reason: 'expired' };
  }

  async revokeFamily(familyId: string): Promise<void> {
    await RefreshSession.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  }

  /** Logout by refresh token. Unknown tokens are ignored so logout never errors. */
  async revokeByToken(presented: string): Promise<void> {
    const found = await RefreshSession.findOne({ tokenHash: hashToken(presented) }).lean();
    if (found) await this.revokeFamily(found.familyId);
  }

  /** A family is live while it holds at least one unrevoked, unexpired token. Access tokens of dead families are refused. */
  async isFamilyActive(familyId: string): Promise<boolean> {
    const live = await RefreshSession.exists({ familyId, revokedAt: null, expiresAt: { $gt: new Date() } });
    return live !== null;
  }
}
