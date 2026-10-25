/**
 * The single API contract. Every request body and response the server sends is described here,
 * the server validates input with these schemas and the extension validates responses with them.
 */
import { z } from 'zod';
import {
  FIELD_LIMITS,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PAGE_TEXT_CAP,
  VOICE_SAMPLE_MAX_CHARS,
} from './config.js';

/** Trimmed string where an empty value becomes null, so "unknown" has exactly one representation. */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === null || v === '' ? null : v));

const nullableEmail = z
  .string()
  .trim()
  .max(FIELD_LIMITS.email)
  .nullable()
  .transform((v) => (v === null || v === '' ? null : v.toLowerCase()))
  .pipe(z.email().nullable());

const httpUrl = z
  .url({ protocol: /^https?$/ })
  .max(FIELD_LIMITS.url);

export const objectId = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');

// Section: enums

export const SourceMode = z.enum(['page', 'selection', 'paste']);
export type SourceMode = z.infer<typeof SourceMode>;

export const Tone = z.enum(['formal', 'warm', 'direct']);
export type Tone = z.infer<typeof Tone>;

export const Length = z.enum(['short', 'medium']);
export type Length = z.infer<typeof Length>;

export const Goal = z.enum(['book_call', 'introduce_service', 'ask_intro']);
export type Goal = z.infer<typeof Goal>;

export const ProspectStatus = z.enum(['drafted', 'sent', 'replied']);
export type ProspectStatus = z.infer<typeof ProspectStatus>;

export const Dials = z.strictObject({ tone: Tone, length: Length, goal: Goal });
export type Dials = z.infer<typeof Dials>;

export const DEFAULT_DIALS: Dials = { tone: 'warm', length: 'short', goal: 'book_call' };

// Section: auth

export const Credentials = z.strictObject({
  email: z.string().trim().toLowerCase().max(FIELD_LIMITS.email).pipe(z.email()),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
});
export type Credentials = z.infer<typeof Credentials>;

/** Login accepts any non empty password so the failure message never reveals the length rule. */
export const LoginRequest = z.strictObject({
  email: z.string().trim().toLowerCase().max(FIELD_LIMITS.email),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const RefreshRequest = z.strictObject({ refreshToken: z.string().min(20).max(200) });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const AuthResponse = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.number().int(),
  refreshToken: z.string(),
  user: z.object({ id: z.string(), email: z.string() }),
});
export type AuthResponse = z.infer<typeof AuthResponse>;

export const DeleteAccountRequest = z.strictObject({ password: z.string().min(1).max(200) });
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequest>;

// Section: settings

export const SenderProfile = z.strictObject({
  name: nullableText(FIELD_LIMITS.name),
  role: nullableText(FIELD_LIMITS.role),
  organisation: nullableText(FIELD_LIMITS.company),
  offer: nullableText(FIELD_LIMITS.senderOffer),
  link: z
    .union([httpUrl, z.literal(''), z.null()])
    .transform((v) => (v === '' ? null : v)),
});
export type SenderProfile = z.infer<typeof SenderProfile>;

export const EMPTY_SENDER: SenderProfile = { name: null, role: null, organisation: null, offer: null, link: null };

/** The draft endpoint refuses to run until these sender fields are filled. */
export function isSenderProfileComplete(p: SenderProfile): boolean {
  return Boolean(p.name && p.organisation && p.offer);
}

export const Settings = z.strictObject({
  sender: SenderProfile,
  defaultDials: Dials,
  footer: nullableText(FIELD_LIMITS.footer),
});
export type Settings = z.infer<typeof Settings>;

// Section: voice samples

export const VoiceSampleCreate = z.strictObject({
  text: z.string().trim().min(40, 'Paste a full email, at least 40 characters').max(VOICE_SAMPLE_MAX_CHARS),
});
export type VoiceSampleCreate = z.infer<typeof VoiceSampleCreate>;

export const VoiceSample = z.object({ id: z.string(), text: z.string(), createdAt: z.string() });
export type VoiceSample = z.infer<typeof VoiceSample>;

export const VoiceSampleList = z.object({ items: z.array(VoiceSample) });
export type VoiceSampleList = z.infer<typeof VoiceSampleList>;

// Section: prospect fields and page snapshot

export const ProspectFields = z.strictObject({
  name: nullableText(FIELD_LIMITS.name),
  role: nullableText(FIELD_LIMITS.role),
  company: nullableText(FIELD_LIMITS.company),
  bio: nullableText(FIELD_LIMITS.bio),
  detail: nullableText(FIELD_LIMITS.detail),
  email: nullableEmail,
});
export type ProspectFields = z.infer<typeof ProspectFields>;

export const FIELD_KEYS = ['name', 'role', 'company', 'bio', 'detail', 'email'] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export const EMPTY_FIELDS: ProspectFields = {
  name: null,
  role: null,
  company: null,
  bio: null,
  detail: null,
  email: null,
};

const shortText = z.string().max(500).nullable();

/** JSON-LD Person or Organization fields kept by the injected reader. */
export const JsonLdEntity = z.object({
  type: z.enum(['Person', 'Organization']),
  name: shortText,
  jobTitle: shortText,
  worksFor: shortText,
  description: z.string().max(1000).nullable(),
  email: shortText,
});
export type JsonLdEntity = z.infer<typeof JsonLdEntity>;

/** Exactly what the injected page function may return. Anything else is rejected. */
export const PageSnapshot = z.strictObject({
  url: z.string().max(FIELD_LIMITS.url),
  title: z.string().max(FIELD_LIMITS.title),
  description: shortText,
  og: z.object({
    title: shortText,
    description: shortText,
    siteName: shortText,
    type: shortText,
  }),
  jsonLd: z.array(JsonLdEntity).max(10),
  headings: z.array(z.string().max(300)).max(40),
  mailtos: z.array(z.string().max(FIELD_LIMITS.email)).max(10),
  text: z.string().max(PAGE_TEXT_CAP),
  textTruncated: z.boolean(),
});
export type PageSnapshot = z.infer<typeof PageSnapshot>;

// Section: extract

export const ExtractRequest = z.strictObject({
  mode: SourceMode,
  url: z.union([httpUrl, z.null()]),
  title: nullableText(FIELD_LIMITS.title),
  text: z.string().trim().min(1, 'Nothing to read').max(PAGE_TEXT_CAP),
  /** Fields found deterministically in the extension (JSON-LD, meta tags, mailto). The model only fills the gaps. */
  hints: ProspectFields,
  /** Emails that literally appear on the page as mailto links. */
  mailtos: z.array(z.email()).max(10).default([]),
});
export type ExtractRequest = z.infer<typeof ExtractRequest>;

export const FieldOrigin = z.enum(['page', 'ai', 'none']);
export type FieldOrigin = z.infer<typeof FieldOrigin>;

export const ExtractResponse = z.object({
  fields: ProspectFields,
  origins: z.record(z.enum(FIELD_KEYS), FieldOrigin),
  aiUsed: z.boolean(),
});
export type ExtractResponse = z.infer<typeof ExtractResponse>;

// Section: draft

export const DraftSource = z.strictObject({
  mode: SourceMode,
  url: z.union([httpUrl, z.null()]),
  title: nullableText(FIELD_LIMITS.title),
});
export type DraftSource = z.infer<typeof DraftSource>;

export const DraftRequest = z.strictObject({
  fields: ProspectFields,
  source: DraftSource,
  dials: Dials,
});
export type DraftRequest = z.infer<typeof DraftRequest>;

/** The model must return exactly this shape (enforced with strict JSON schema and validated again here). */
export const DraftOutput = z.strictObject({
  subject: z.string().trim().min(1).max(FIELD_LIMITS.subject),
  body: z.string().trim().min(1).max(FIELD_LIMITS.body),
  detailUsed: z.string().trim().min(1).max(FIELD_LIMITS.detail),
});
export type DraftOutput = z.infer<typeof DraftOutput>;

// Section: prospects

export const Prospect = z.object({
  id: z.string(),
  name: z.string().nullable(),
  role: z.string().nullable(),
  company: z.string().nullable(),
  bio: z.string().nullable(),
  detail: z.string().nullable(),
  email: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  sourceTitle: z.string().nullable(),
  sourceMode: SourceMode,
  subject: z.string(),
  body: z.string(),
  detailUsed: z.string(),
  tone: Tone,
  length: Length,
  goal: Goal,
  baseInstructionsVersion: z.string(),
  model: z.string(),
  status: ProspectStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Prospect = z.infer<typeof Prospect>;

export const DraftResponse = z.object({ draft: DraftOutput, prospect: Prospect });
export type DraftResponse = z.infer<typeof DraftResponse>;

export const ProspectFilter = z.strictObject({
  status: ProspectStatus.optional(),
  q: z.string().trim().max(FIELD_LIMITS.search).optional(),
});
export type ProspectFilter = z.infer<typeof ProspectFilter>;

export const ProspectListQuery = ProspectFilter.extend({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type ProspectListQuery = z.infer<typeof ProspectListQuery>;

export const ProspectList = z.object({ items: z.array(Prospect), nextCursor: z.string().nullable() });
export type ProspectList = z.infer<typeof ProspectList>;

export const ProspectPatch = z
  .strictObject({
    name: nullableText(FIELD_LIMITS.name),
    role: nullableText(FIELD_LIMITS.role),
    company: nullableText(FIELD_LIMITS.company),
    bio: nullableText(FIELD_LIMITS.bio),
    detail: nullableText(FIELD_LIMITS.detail),
    email: nullableEmail,
    subject: z.string().trim().min(1).max(FIELD_LIMITS.subject),
    body: z.string().trim().min(1).max(FIELD_LIMITS.body),
    status: ProspectStatus,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type ProspectPatch = z.infer<typeof ProspectPatch>;

export const DeleteAllQuery = z.strictObject({ confirm: z.literal('all') });

export const DeletedCount = z.object({ deleted: z.number().int() });
export type DeletedCount = z.infer<typeof DeletedCount>;

// Section: errors

export const ErrorCode = z.enum([
  'VALIDATION',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'SESSION_EXPIRED',
  'SIGNUP_DISABLED',
  'EMAIL_TAKEN',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PROFILE_INCOMPLETE',
  'VOICE_SAMPLE_LIMIT',
  'RATE_LIMITED',
  'AI_RATE_LIMITED',
  'DAILY_CAP',
  'AI_FAILED',
  'AI_UNAVAILABLE',
  'HTTPS_REQUIRED',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    retryAfterSeconds: z.number().int().optional(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export const Health = z.object({ ok: z.literal(true), version: z.string() });
