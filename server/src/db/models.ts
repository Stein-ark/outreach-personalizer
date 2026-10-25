/**
 * Mongoose models. Every collection that holds user data carries userId, and every query in the
 * repositories filters by it, so one user's data is never reachable from another user's token.
 * Only email addresses (with the page they were found on) and drafts are stored, never page text.
 */
import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';
import { Length, ProspectStatus, Tone } from '@op/shared';

const nullableString = { type: String, default: null };

const SenderProfileSchema = new Schema(
  {
    name: nullableString,
    link: nullableString,
  },
  { _id: false },
);

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    settings: {
      sender: { type: SenderProfileSchema, default: () => ({}) },
    },
    /** The spreadsheet new emails go into, and how many it holds so far. */
    sheet: {
      current: { type: Number, default: 1 },
      count: { type: Number, default: 0 },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const RefreshSessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  /** All tokens issued from one login share a family, so reuse of any old token revokes the whole login. */
  familyId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
});
// MongoDB deletes the document once expiresAt passes. Revoked tokens stay until then so reuse is still detected.
RefreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** One collected email address. */
const ProspectSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    email: { type: String, required: true },
    sourceUrl: nullableString,
    sourceTitle: nullableString,
    // Draft fields stay null until the user drafts the sheet.
    subject: nullableString,
    body: nullableString,
    tone: { type: String, enum: [...Tone.options, null], default: null },
    length: { type: String, enum: [...Length.options, null], default: null },
    baseInstructionsVersion: nullableString,
    model: nullableString,
    status: { type: String, enum: ProspectStatus.options, default: 'new' },
    /** The spreadsheet this email belongs to. Set once, when first saved. */
    sheet: { type: Number, required: true },
    /** Set once when first saved. MongoDB deletes the email after this moment (TTL index below). */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
// One entry per email address per user, so collecting a page again never duplicates anyone.
ProspectSchema.index({ userId: 1, email: 1 }, { unique: true });
ProspectSchema.index({ userId: 1, createdAt: -1, _id: -1 });
ProspectSchema.index({ userId: 1, status: 1, createdAt: -1, _id: -1 });
ProspectSchema.index({ userId: 1, sheet: 1 });
ProspectSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** Per user, per UTC day counters for the daily draft cap. */
const UsageCounterSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  day: { type: String, required: true },
  kind: { type: String, enum: ['draft'], required: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});
UsageCounterSchema.index({ userId: 1, day: 1, kind: 1 }, { unique: true });
UsageCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: Types.ObjectId };
export type ProspectDoc = InferSchemaType<typeof ProspectSchema> & { _id: Types.ObjectId };

export const User = mongoose.model('User', UserSchema);
export const RefreshSession = mongoose.model('RefreshSession', RefreshSessionSchema);
export const Prospect = mongoose.model('Prospect', ProspectSchema);
export const UsageCounter = mongoose.model('UsageCounter', UsageCounterSchema);

/** Builds every index declared above. Called at boot and in tests so the unique constraints exist before use. */
export async function syncIndexes(): Promise<void> {
  await Promise.all([User, RefreshSession, Prospect, UsageCounter].map((m) => m.syncIndexes()));
}
