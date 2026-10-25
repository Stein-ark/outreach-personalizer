/**
 * Prospect repository. Every function takes the authenticated userId and puts it in the query filter itself,
 * so an id supplied by the client can only ever match the caller's own documents.
 */
import { Types } from 'mongoose';
import type { DraftOutput, DraftRequest, Prospect as ProspectDto, ProspectFilter, ProspectListQuery, ProspectPatch } from '@op/shared';
import { normalizeUrl } from '@op/shared';
import { Prospect, type ProspectDoc } from '../db/models.js';
import { notFound } from '../lib/errors.js';

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
    subject: doc.subject,
    body: doc.body,
    detailUsed: doc.detailUsed,
    tone: doc.tone,
    length: doc.length,
    goal: doc.goal,
    baseInstructionsVersion: doc.baseInstructionsVersion,
    model: doc.model,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function filterQuery(userId: string, filter: ProspectFilter): Record<string, unknown> {
  const q: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
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

const ownFilter = (userId: string, id: string) => ({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) });

export async function getProspect(userId: string, id: string): Promise<ProspectDto> {
  const doc = await Prospect.findOne(ownFilter(userId, id)).lean<ProspectDoc>();
  if (!doc) throw notFound('Prospect');
  return toDto(doc);
}

export async function updateProspect(userId: string, id: string, patch: ProspectPatch): Promise<ProspectDto> {
  const doc = await Prospect.findOneAndUpdate(ownFilter(userId, id), { $set: patch }, { returnDocument: 'after' }).lean<ProspectDoc>();
  if (!doc) throw notFound('Prospect');
  return toDto(doc);
}

export async function deleteProspect(userId: string, id: string): Promise<void> {
  const res = await Prospect.deleteOne(ownFilter(userId, id));
  if (res.deletedCount === 0) throw notFound('Prospect');
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
}

/** Saves the drafted prospect. A page that was saved before (same normalized URL) is updated in place. */
export async function saveDraftedProspect(userId: string, input: SaveDraftInput): Promise<ProspectDto> {
  const { request, draft } = input;
  const sourceUrl = request.source.url ? normalizeUrl(request.source.url) : null;
  const values = {
    ...request.fields,
    sourceUrl,
    sourceTitle: request.source.title,
    sourceMode: request.source.mode,
    subject: draft.subject,
    body: draft.body,
    detailUsed: draft.detailUsed,
    ...request.dials,
    baseInstructionsVersion: input.baseInstructionsVersion,
    model: input.model,
    status: 'drafted' as const,
  };
  const owner = new Types.ObjectId(userId);
  if (!sourceUrl) {
    const created = await Prospect.create({ userId: owner, ...values });
    return toDto(created.toObject() as ProspectDoc);
  }
  const doc = await Prospect.findOneAndUpdate(
    { userId: owner, sourceUrl },
    { $set: values, $setOnInsert: { userId: owner } },
    { upsert: true, returnDocument: 'after' },
  ).lean<ProspectDoc>();
  return toDto(doc!);
}
