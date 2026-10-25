/**
 * Short lived access tokens (HS256 JWT) and opaque refresh tokens.
 * Refresh tokens are random 32 byte values. Only their SHA-256 hash is stored, which is safe because
 * the token itself has full entropy (no dictionary to attack), so a slow hash is not needed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'outreach-personalizer';
const AUDIENCE = 'outreach-personalizer-extension';

export interface AccessClaims {
  userId: string;
  familyId: string;
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly accessTtlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async signAccess(claims: AccessClaims): Promise<{ token: string; expiresAt: number }> {
    const expiresAt = Math.floor(Date.now() / 1000) + this.accessTtlSeconds;
    const token = await new SignJWT({ sid: claims.familyId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(this.key);
    return { token, expiresAt: expiresAt * 1000 };
  }

  /** Returns the claims, or null for any invalid, expired or tampered token. */
  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
      return { userId: payload.sub, familyId: payload.sid };
    } catch {
      return null;
    }
  }
}

export const newRefreshToken = () => randomBytes(32).toString('base64url');
export const newFamilyId = () => randomBytes(16).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
