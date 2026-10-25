/**
 * The single API contract. Every request body and response the server sends is described here,
 * the server validates input with these schemas and the extension validates responses with them.
 */
import { z } from 'zod';
import { COLLECT_MAX_EMAILS, FIELD_LIMITS, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from './config.js';

/** Trimmed string where an empty value becomes null, so "unknown" has exactly one representation. */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === null || v === '' ? null : v));

const email = z.string().trim().toLowerCase().max(FIELD_LIMITS.email).pipe(z.email());

const httpUrl = z.url({ protocol: /^https?$/ }).max(FIELD_LIMITS.url);

export const objectId = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');

// Section: drafting options

export const Tone = z.enum(['formal', 'warm', 'direct']);
export type Tone = z.infer<typeof Tone>;

export const Length = z.enum(['short', 'medium']);
export type Length = z.infer<typeof Length>;

export const Dials = z.strictObject({ tone: Tone, length: Length });
export type Dials = z.infer<typeof Dials>;

export const DEFAULT_DIALS: Dials = { tone: 'warm', length: 'short' };

/** new = collected, no draft yet. */
export const ProspectStatus = z.enum(['new', 'drafted', 'sent', 'replied']);
export type ProspectStatus = z.infer<typeof ProspectStatus>;

// Section: auth

export const Credentials = z.strictObject({
  email,
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

/** The only facts a draft may state about the sender: their name (for signing off) and an optional link. */
export const SenderProfile = z.strictObject({
  name: nullableText(FIELD_LIMITS.name),
  link: z.union([httpUrl, z.literal(''), z.null()]).transform((v) => (v === '' ? null : v)),
});
export type SenderProfile = z.infer<typeof SenderProfile>;

export const EMPTY_SENDER: SenderProfile = { name: null, link: null };

export const Settings = z.strictObject({ sender: SenderProfile });
export type Settings = z.infer<typeof Settings>;

// Section: collection

/** Sent by the extension's collector: the email addresses visible on one page. */
export const CollectRequest = z.strictObject({
  url: httpUrl,
  title: nullableText(FIELD_LIMITS.title),
  emails: z.array(email).min(1).max(COLLECT_MAX_EMAILS),
});
export type CollectRequest = z.infer<typeof CollectRequest>;

export const CollectResponse = z.object({ added: z.number().int(), alreadySaved: z.number().int() });
export type CollectResponse = z.infer<typeof CollectResponse>;

// Section: prospects (one saved email address)

export const Prospect = z.object({
  id: z.string(),
  email: z.string(),
  sourceUrl: z.string().nullable(),
  sourceTitle: z.string().nullable(),
  /** The draft fields stay null until the user drafts the sheet. */
  subject: z.string().nullable(),
  body: z.string().nullable(),
  status: ProspectStatus,
  /** Which spreadsheet this email belongs to (sheets of SHEET_SIZE). */
  sheet: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** When the server deletes this email. The sheet is downloaded before then. */
  expiresAt: z.string(),
});
export type Prospect = z.infer<typeof Prospect>;

export const ProspectFilter = z.strictObject({
  status: ProspectStatus.optional(),
  q: z.string().trim().max(FIELD_LIMITS.search).optional(),
  sheet: z.coerce.number().int().min(1).optional(),
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

// Section: sheets

/** One spreadsheet's worth of emails and how many have a draft. */
export const SheetSummary = z.object({
  number: z.number().int(),
  total: z.number().int(),
  drafted: z.number().int(),
  /** When the oldest email in the sheet is deleted. The sheet must be downloaded before then. */
  oldestExpiresAt: z.string(),
  current: z.boolean(),
});
export type SheetSummary = z.infer<typeof SheetSummary>;

export const SheetList = z.object({ items: z.array(SheetSummary), current: z.number().int() });
export type SheetList = z.infer<typeof SheetList>;

/** Closes the current sheet early (after it was downloaded before filling up), so new emails start the next one. */
export const CloseSheetRequest = z.strictObject({ number: z.number().int().min(1) });
export type CloseSheetRequest = z.infer<typeof CloseSheetRequest>;

// Section: drafting a sheet

/** What the user wants to say. The AI writes one message for every email in the sheet. */
export const SheetDraftRequest = z.strictObject({
  message: z.string().trim().min(10, 'Say a little more about what you want to convey').max(FIELD_LIMITS.message),
  dials: Dials,
});
export type SheetDraftRequest = z.infer<typeof SheetDraftRequest>;

/** The model must return exactly this shape (enforced with strict JSON schema and validated again here). */
export const DraftOutput = z.strictObject({
  subject: z.string().trim().min(1).max(FIELD_LIMITS.subject),
  body: z.string().trim().min(1).max(FIELD_LIMITS.body),
});
export type DraftOutput = z.infer<typeof DraftOutput>;

export const SheetDraftResponse = z.object({ draft: DraftOutput, updated: z.number().int() });
export type SheetDraftResponse = z.infer<typeof SheetDraftResponse>;

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
  'RATE_LIMITED',
  'AI_RATE_LIMITED',
  'DAILY_CAP',
  'AI_FAILED',
  'AI_UNAVAILABLE',
  'HTTPS_REQUIRED',
  'DB_UNAVAILABLE',
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

/** ok means the process is up. db and ai report each dependency separately, so one being down is visible on its own. */
export const Health = z.object({
  ok: z.literal(true),
  version: z.string(),
  db: z.enum(['up', 'down']),
  ai: z.enum(['up', 'unreachable', 'unchecked']),
});
export type Health = z.infer<typeof Health>;
