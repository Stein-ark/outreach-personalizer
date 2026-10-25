/**
 * Spreadsheets of SHEET_SIZE emails. Every newly saved email takes the next slot in the user's current sheet, and a
 * full sheet rolls over to the next number. The extension downloads each sheet as an .xlsx as soon as it is full, or
 * earlier if its oldest email is about to be deleted (3 hour retention), then closes it.
 */
import { Types } from 'mongoose';
import { SHEET_SIZE, type SheetList } from '@op/shared';
import { Prospect, User } from '../db/models.js';
import { AppError } from '../lib/errors.js';

/**
 * Reserves n slots and returns the sheet number for each. Uses compare and set on the user's counter, so concurrent
 * requests (several tabs collecting at once) never put more than SHEET_SIZE people in one sheet.
 */
export async function reserveSheetSlots(userId: string, n: number): Promise<number[]> {
  if (n === 0) return [];
  const owner = new Types.ObjectId(userId);
  for (let attempt = 0; attempt < 8; attempt++) {
    const user = await User.findById(owner, { sheet: 1 }).lean();
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    const before = { current: user.sheet?.current ?? 1, count: user.sheet?.count ?? 0 };
    let { current, count } = before;
    const slots: number[] = [];
    for (let i = 0; i < n; i++) {
      if (count >= SHEET_SIZE) {
        current += 1;
        count = 0;
      }
      slots.push(current);
      count += 1;
    }
    // Users created before sheets existed have no counter yet: match on its absence.
    const match = user.sheet?.current === undefined ? { 'sheet.current': { $exists: false } } : { 'sheet.current': before.current, 'sheet.count': before.count };
    const res = await User.updateOne({ _id: owner, ...match }, { $set: { 'sheet.current': current, 'sheet.count': count } });
    if (res.modifiedCount === 1) return slots;
  }
  throw new AppError(503, 'CONFLICT', 'Too many saves at once. Try again.');
}

/** Closes the current sheet (it was downloaded before filling up), so the next email starts a new one. */
export async function closeSheet(userId: string, number: number): Promise<void> {
  await User.updateOne(
    { _id: new Types.ObjectId(userId), 'sheet.current': number, 'sheet.count': { $gt: 0 } },
    { $set: { 'sheet.current': number + 1, 'sheet.count': 0 } },
  );
}

/** Live sheets (emails not yet deleted) with how many have a draft, newest first. */
export async function listSheets(userId: string): Promise<SheetList> {
  const owner = new Types.ObjectId(userId);
  const user = await User.findById(owner, { sheet: 1 }).lean();
  const current = user?.sheet?.current ?? 1;
  const rows = await Prospect.aggregate<{ _id: number; total: number; drafted: number; oldest: Date }>([
    { $match: { userId: owner, expiresAt: { $gt: new Date() } } },
    {
      $group: {
        _id: '$sheet',
        total: { $sum: 1 },
        drafted: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$subject', null] }, null] }, 1, 0] } },
        oldest: { $min: '$expiresAt' },
      },
    },
    { $sort: { _id: -1 } },
  ]);
  return {
    current,
    items: rows.map((r) => ({
      number: r._id,
      total: r.total,
      drafted: r.drafted,
      oldestExpiresAt: r.oldest.toISOString(),
      current: r._id === current,
    })),
  };
}
