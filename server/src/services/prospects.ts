/**
 * Saved email addresses. Every function takes the authenticated userId and puts it in the query filter itself,
 * so an id supplied by the client can only ever match the caller's own documents.
 */
import { Types } from 'mongoose';
import type {
  CollectRequest,
  CollectResponse,
  DraftOutput,
  Prospect as ProspectDto,
  ProspectFilter,
  ProspectListQuery,
  ProspectPatch,
  SheetDraftRequest,
} from '@op/shared';
import { normalizeUrl } from '@op/shared';
import { Prospect, type ProspectDoc } from '../db/models.js';
import { AppError } from '../lib/errors.js';
import { reserveSheetSlots } from './sheets.js';

export function toDto(doc: ProspectDoc): ProspectDto {
  return {
    id: String(doc._id),
    email: doc.email,
    sourceUrl: doc.sourceUrl ?? null,
    sourceTitle: doc.sourceTitle ?? null,
    subject: doc.subject ?? null,
    body: doc.body ?? null,
    status: doc.status,
    sheet: doc.sheet,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
  };
}

const gone = () =>
  new AppError(404, 'NOT_FOUND', 'This email is no longer saved. Saved emails are deleted a few hours after they are added, after their sheet is downloaded.');

/**
 * MongoDB's TTL monitor deletes expired documents about once a minute, so every read also excludes anything already
 * past its expiry. Users never see an email after the moment they were told it would be deleted.
 */
const live = () => ({ expiresAt: { $gt: new Date() } });

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function filterQuery(userId: string, filter: ProspectFilter): Record<string, unknown> {
  const q: Record<string, unknown> = { userId: new Types.ObjectId(userId), ...live() };
  if (filter.status) q.status = filter.status;
  if (filter.sheet) q.sheet = filter.sheet;
  if (filter.q) {
    // Escaped, so search input is matched literally and cannot inject regex operators.
    const re = new RegExp(escapeRegex(filter.q), 'i');
    q.$or = [{ email: re }, { sourceTitle: re }];
  }
  return q;
}

interface Cursor {
  c: string;
  i: string;
}

const encodeCursor = (doc: ProspectDoc) =>
  Buffer.from(JSON.stringify({ c: doc.createdAt.toISOString(), i: String(doc._id) } satisfies Cursor)).toString('base64url');

function decodeCursor(raw: string): Cursor | null {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof v.c === 'string' && typeof v.i === 'string' && Types.ObjectId.isValid(v.i) && !Number.isNaN(Date.parse(v.c))) {
      return { c: v.c, i: v.i };
    }
  } catch {
    // fall through
  }
  return null;
}

export async function listProspects(userId: string, query: ProspectListQuery) {
  const base = filterQuery(userId, query);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const q = cursor
    ? {
        $and: [
          base,
          {
            $or: [
              { createdAt: { $lt: new Date(cursor.c) } },
              { createdAt: new Date(cursor.c), _id: { $lt: new Types.ObjectId(cursor.i) } },
            ],
          },
        ],
      }
    : base;
  const docs = await Prospect.find(q).sort({ createdAt: -1, _id: -1 }).limit(query.limit + 1).lean<ProspectDoc[]>();
  const page = docs.slice(0, query.limit);
  const last = page[page.length - 1];
  return { items: page.map(toDto), nextCursor: docs.length > query.limit && last ? encodeCursor(last) : null };
}

/** Up to this many rows go into one export, oldest first (the order they were collected). */
export const EXPORT_ROW_LIMIT = 5000;

export async function prospectsForExport(userId: string, filter: ProspectFilter): Promise<ProspectDto[]> {
  const docs = await Prospect.find(filterQuery(userId, filter)).sort({ createdAt: 1, _id: 1 }).limit(EXPORT_ROW_LIMIT).lean<ProspectDoc[]>();
  return docs.map(toDto);
}

const ownFilter = (userId: string, id: string) => ({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId), ...live() });

export async function getProspect(userId: string, id: string): Promise<ProspectDto> {
  const doc = await Prospect.findOne(ownFilter(userId, id)).lean<ProspectDoc>();
  if (!doc) throw gone();
  return toDto(doc);
}

export async function updateProspect(userId: string, id: string, patch: ProspectPatch): Promise<ProspectDto> {
  const doc = await Prospect.findOneAndUpdate(ownFilter(userId, id), { $set: patch }, { returnDocument: 'after' }).lean<ProspectDoc>();
  if (!doc) throw gone();
  return toDto(doc);
}

export async function deleteProspect(userId: string, id: string): Promise<void> {
  const res = await Prospect.deleteOne(ownFilter(userId, id));
  if (res.deletedCount === 0) throw gone();
}

export async function deleteAllProspects(userId: string): Promise<number> {
  const res = await Prospect.deleteMany({ userId: new Types.ObjectId(userId) });
  return res.deletedCount;
}

/**
 * Saves the email addresses found on one page. Each new address takes the next slot in the user's current sheet.
 * Addresses already saved are left untouched, so visiting a page again never duplicates anyone or loses a draft.
 */
export async function collectEmails(userId: string, req: CollectRequest, ttlMs: number): Promise<CollectResponse> {
  const owner = new Types.ObjectId(userId);
  const sourceUrl = normalizeUrl(req.url);
  const all = [...new Set(req.emails)];
  // Expired entries the TTL monitor has not removed yet must not count as "already saved".
  await Prospect.deleteMany({ userId: owner, email: { $in: all }, expiresAt: { $lte: new Date() } });
  const known = new Set((await Prospect.find({ userId: owner, email: { $in: all } }, { email: 1 }).lean()).map((d) => d.email));
  const fresh = all.filter((e) => !known.has(e));
  if (fresh.length === 0) return { added: 0, alreadySaved: all.length };

  const sheets = await reserveSheetSlots(userId, fresh.length);
  const expiresAt = new Date(Date.now() + ttlMs);
  const result = await Prospect.bulkWrite(
    fresh.map((email, i) => ({
      updateOne: {
        filter: { userId: owner, email },
        update: {
          $setOnInsert: { userId: owner, email, sourceUrl, sourceTitle: req.title, status: 'new', sheet: sheets[i]!, expiresAt },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return { added: result.upsertedCount, alreadySaved: all.length - result.upsertedCount };
}

export interface SheetDraftInput {
  draft: DraftOutput;
  dials: SheetDraftRequest['dials'];
  baseInstructionsVersion: string;
  model: string;
}

/**
 * Puts one draft on every live email in a sheet that has not been contacted yet. Emails already marked sent or
 * replied keep the message they were sent with.
 */
export async function applySheetDraft(userId: string, sheet: number, input: SheetDraftInput): Promise<number> {
  const res = await Prospect.updateMany(
    { userId: new Types.ObjectId(userId), sheet, status: { $in: ['new', 'drafted'] }, ...live() },
    {
      $set: {
        subject: input.draft.subject,
        body: input.draft.body,
        ...input.dials,
        baseInstructionsVersion: input.baseInstructionsVersion,
        model: input.model,
        status: 'drafted',
      },
    },
  );
  return res.modifiedCount;
}

export async function countDraftable(userId: string, sheet: number): Promise<number> {
  return Prospect.countDocuments({ userId: new Types.ObjectId(userId), sheet, status: { $in: ['new', 'drafted'] }, ...live() });
}
