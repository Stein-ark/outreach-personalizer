/**
 * Mongoose models. Every collection that holds user data carries userId, and every query in the
 * repositories filters by it, so one user's data is never reachable from another user's token.
 * Raw page text is never stored, only the extracted fields.
 */
import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';
import { DEFAULT_DIALS, Goal, Length, ProspectStatus, SourceMode, Tone } from '@op/shared';

const nullableString = { type: String, default: null };

const SenderProfileSchema = new Schema(
  {
    name: nullableString,
    role: nullableString,
    organisation: nullableString,
    offer: nullableString,
    link: nullableString,
  },
  { _id: false },
);

const DialsSchema = new Schema(
  {
    tone: { type: String, enum: Tone.options, default: DEFAULT_DIALS.tone },
    length: { type: String, enum: Length.options, default: DEFAULT_DIALS.length },
    goal: { type: String, enum: Goal.options, default: DEFAULT_DIALS.goal },
  },
  { _id: false },
);

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    settings: {
      sender: { type: SenderProfileSchema, default: () => ({}) },
      defaultDials: { type: DialsSchema, default: () => ({}) },
      footer: nullableString,
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

const VoiceSampleSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    text: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
VoiceSampleSchema.index({ userId: 1, createdAt: 1 });

const ProspectSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: nullableString,
    role: nullableString,
    company: nullableString,
    bio: nullableString,
    detail: nullableString,
    email: nullableString,
    sourceUrl: nullableString,
    sourceTitle: nullableString,
    sourceMode: { type: String, enum: SourceMode.options, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    detailUsed: { type: String, required: true },
    tone: { type: String, enum: Tone.options, required: true },
    length: { type: String, enum: Length.options, required: true },
    goal: { type: String, enum: Goal.options, required: true },
    baseInstructionsVersion: { type: String, required: true },
    model: { type: String, required: true },
    status: { type: String, enum: ProspectStatus.options, default: 'drafted' },
  },
  { timestamps: true },
);
// Saving the same page twice updates the existing prospect. Pasted text has no URL and is never deduplicated.
ProspectSchema.index(
  { userId: 1, sourceUrl: 1 },
  { unique: true, partialFilterExpression: { sourceUrl: { $type: 'string' } } },
);
ProspectSchema.index({ userId: 1, createdAt: -1, _id: -1 });
ProspectSchema.index({ userId: 1, status: 1, createdAt: -1, _id: -1 });

/** Per user, per UTC day counters for the daily draft and extract caps. */
const UsageCounterSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  day: { type: String, required: true },
  kind: { type: String, enum: ['draft', 'extract'], required: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});
UsageCounterSchema.index({ userId: 1, day: 1, kind: 1 }, { unique: true });
UsageCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: Types.ObjectId };
export type ProspectDoc = InferSchemaType<typeof ProspectSchema> & { _id: Types.ObjectId };

export const User = mongoose.model('User', UserSchema);
export const RefreshSession = mongoose.model('RefreshSession', RefreshSessionSchema);
export const VoiceSample = mongoose.model('VoiceSample', VoiceSampleSchema);
export const Prospect = mongoose.model('Prospect', ProspectSchema);
export const UsageCounter = mongoose.model('UsageCounter', UsageCounterSchema);

/** Builds every index declared above. Called at boot and in tests so the unique constraints exist before use. */
export async function syncIndexes(): Promise<void> {
  await Promise.all([User, RefreshSession, VoiceSample, Prospect, UsageCounter].map((m) => m.syncIndexes()));
}
