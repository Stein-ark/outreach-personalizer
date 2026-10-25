/**
 * Prospect repository. Every function takes the authenticated userId and puts it in the query filter itself,
 * so an id supplied by the client can only ever match the caller's own documents.
 */
import { Types } from 'mongoose';
import type { CollectRequest, CollectResponse, DraftOutput, DraftRequest, Prospect as ProspectDto, ProspectFilter, ProspectListQuery, ProspectPatch } from '@op/shared';
import { normalizeUrl } from '@op/shared';
import { Prospect, type ProspectDoc } from '../db/models.js';
import { AppError } from '../lib/errors.js';

export function toDto(doc: ProspectDoc): ProspectDto {
  return {
    id: String(doc._id),
    name: doc.name ?? null,
    role: doc.role ?? null,
    company: doc.company ?? null,
    bio: doc.bio ?? null,
    detail: doc.detail ?? null,
    email: doc.email ?? null,
    sourceUrl: doc.sourceUrl ?? null,
    sourceTitle: doc.sourceTitle ?? null,
    sourceMode: doc.sourceMode,
    subject: doc.subject ?? null,
    body: doc.body ?? null,
    detailUsed: doc.detailUsed ?? null,
    tone: doc.tone ?? null,
    length: doc.length ?? null,
    goal: doc.goal ?? null,
    baseInstructionsVersion: doc.baseInstructionsVersion ?? null,
    model: doc.model ?? null,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
  };
}

const gone = () =>
  new AppError(404, 'NOT_FOUND', 'This prospect is no longer saved. Saved prospects are deleted a few hours after they are added, so export your list before then.');

/**
 * MongoDB's TTL monitor deletes expired documents about once a minute, so every read also excludes anything already
 * past its expiry. Users never see a prospect after the moment they were told it would be deleted.
 */
const live = () => ({ expiresAt: { $gt: new Date() } });

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function filterQuery(userId: string, filter: ProspectFilter): Record<string, unknown> {
  const q: Record<string, unknown> = { userId: new Types.ObjectId(userId), ...live() };
  if (filter.status) q.status = filter.status;
  if (filter.q) {
    // Escaped, so search input is matched literally and cannot inject regex operators.
    const re = new RegExp(escapeRegex(filter.q), 'i');
    q.$or = [{ name: re }, { company: re }, { role: re }, { email: re }, { sourceTitle: re }];
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

/** Up to this many rows go into one export, newest first. */
export const EXPORT_ROW_LIMIT = 5000;

export async function prospectsForExport(userId: string, filter: ProspectFilter): Promise<ProspectDto[]> {
  const docs = await Prospect.find(filterQuery(userId, filter)).sort({ createdAt: -1, _id: -1 }).limit(EXPORT_ROW_LIMIT).lean<ProspectDoc[]>();
  return docs.map(toDto);
}

const ownFilter = (userId: string, id: string) => ({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId), ...live() });

export async function getProspect(userId: string, id: string): Promise<ProspectDto> {
  const doc = await Prospect.findOne(ownFilter(userId, id)).lean<ProspectDoc>();
  if (!doc) throw gone();
  return toDto(doc);
}

const isDuplicateKey = (err: unknown) => (err as { code?: number } | null)?.code === 11000;

const emailTaken = () => new AppError(409, 'CONFLICT', 'Another saved prospect already has this email address.');

export async function updateProspect(userId: string, id: string, patch: ProspectPatch): Promise<ProspectDto> {
  let doc;
  try {
    doc = await Prospect.findOneAndUpdate(ownFilter(userId, id), { $set: patch }, { returnDocument: 'after' }).lean<ProspectDoc>();
  } catch (err) {
    if (isDuplicateKey(err)) throw emailTaken();
    throw err;
  }
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

export interface SaveDraftInput {
  request: DraftRequest;
  draft: DraftOutput;
  baseInstructionsVersion: string;
  model: string;
  /** How long a newly saved prospect is kept. Re-drafting a saved page does not extend it. */
  ttlMs: number;
}

/** Saves the drafted prospect. A page that was saved before (same normalized URL) is updated in place. */
/**
 * Saves a drafted prospect. It merges into the user's existing live prospect for the same page (drafted before) or the
 * same email (for example one collected automatically), otherwise it creates a new one. The expiry is set only on
 * creation, so a merge never extends it.
 */
export async function saveDraftedProspect(userId: string, input: SaveDraftInput): Promise<ProspectDto> {
  const { request, draft } = input;
  const sourceUrl = request.source.url ? normalizeUrl(request.source.url) : null;
  // Only a whole page read is one prospect per page. A selection or a collected person may share a page with others.
  const pageKey = request.source.mode === 'page' ? sourceUrl : null;
  const values = {
    ...request.fields,
    sourceUrl,
    sourceTitle: request.source.title,
    sourceMode: request.source.mode,
    pageKey,
    subject: draft.subject,
    body: draft.body,
    detailUsed: draft.detailUsed,
    ...request.dials,
    baseInstructionsVersion: input.baseInstructionsVersion,
    model: input.model,
    status: 'drafted' as const,
  };
  const owner = new Types.ObjectId(userId);
  const keys = [...(pageKey ? [{ pageKey }] : []), ...(request.fields.email ? [{ email: request.fields.email }] : [])];

  // Expired copies the TTL monitor has not removed yet would otherwise be revived with their old expiry.
  if (keys.length) await Prospect.deleteMany({ userId: owner, $or: keys, expiresAt: { $lte: new Date() } });

  const existing = keys.length ? await Prospect.findOne({ userId: owner, $or: keys }).lean<ProspectDoc>() : null;
  try {
    if (existing) {
      const doc = await Prospect.findOneAndUpdate({ _id: existing._id, userId: owner }, { $set: values }, { returnDocument: 'after' }).lean<ProspectDoc>();
      return toDto(doc!);
    }
    const created = await Prospect.create({ userId: owner, ...values, expiresAt: new Date(Date.now() + input.ttlMs) });
    return toDto(created.toObject() as ProspectDoc);
  } catch (err) {
    // The page and the email matched two different saved prospects. Keep the page's one and leave the email to the user.
    if (isDuplicateKey(err)) throw emailTaken();
    throw err;
  }
}

/**
 * Automatic collection: saves each person (email plus nearby name) from one page as a "new" prospect. People already
 * saved (same email) are left untouched, so collecting a page again never overwrites drafts or edits.
 */
export async function collectProspects(userId: string, req: CollectRequest, ttlMs: number): Promise<CollectResponse> {
  const owner = new Types.ObjectId(userId);
  const sourceUrl = normalizeUrl(req.url);
  const unique = [...new Map(req.people.map((p) => [p.email, p])).values()];
  await Prospect.deleteMany({ userId: owner, email: { $in: unique.map((p) => p.email) }, expiresAt: { $lte: new Date() } });
  const expiresAt = new Date(Date.now() + ttlMs);
  const result = await Prospect.bulkWrite(
    unique.map((p) => ({
      updateOne: {
        filter: { userId: owner, email: p.email },
        update: {
          $setOnInsert: {
            userId: owner,
            email: p.email,
            name: p.name,
            role: null,
            company: null,
            bio: null,
            detail: null,
            sourceUrl,
            sourceTitle: req.title,
            sourceMode: 'auto',
            pageKey: null,
            status: 'new',
            expiresAt,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return { added: result.upsertedCount, alreadySaved: unique.length - result.upsertedCount };
}
