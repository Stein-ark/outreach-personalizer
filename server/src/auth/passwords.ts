/** Password hashing with argon2id (OWASP recommended). */
import argon2 from 'argon2';

const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => argon2.hash(password, OPTIONS);

let dummyHash: Promise<string> | undefined;

/**
 * Verifies a password. With no stored hash (unknown email) it still runs a full verify against a dummy hash,
 * so response time does not reveal whether an account exists.
 */
export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  if (hash === null) {
    dummyHash ??= argon2.hash('dummy password for timing', OPTIONS);
    await argon2.verify(await dummyHash, password).catch(() => false);
    return false;
  }
  return argon2.verify(hash, password).catch(() => false);
}
