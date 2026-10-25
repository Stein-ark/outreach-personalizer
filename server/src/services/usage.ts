/**
 * Per user daily caps (UTC day). consume() increments atomically and refuses once the cap is reached,
 * refund() gives a unit back when the AI call it paid for failed.
 */
import { Types } from 'mongoose';
import { UsageCounter } from '../db/models.js';
import { AppError } from '../lib/errors.js';

export type UsageKind = 'draft';

const today = () => new Date().toISOString().slice(0, 10);

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export async function consumeDaily(userId: string, kind: UsageKind, cap: number): Promise<void> {
  const day = today();
  try {
    // The filter only matches while count is under the cap. At the cap the upsert tries to insert a second
    // document for the same key and the unique index rejects it, which is how "cap reached" is detected.
    await UsageCounter.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), day, kind, count: { $lt: cap } },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + 2 * 86_400_000) } },
      { upsert: true },
    );
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    throw new AppError(429, 'DAILY_CAP', `You have reached today's limit of ${cap} drafts. It resets at midnight UTC.`, secondsUntilUtcMidnight());
  }
}

export async function refundDaily(userId: string, kind: UsageKind): Promise<void> {
  await UsageCounter.updateOne({ userId: new Types.ObjectId(userId), day: today(), kind, count: { $gt: 0 } }, { $inc: { count: -1 } });
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  return Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000);
}
