/**
 * Product wide constants shared by the extension and the server.
 * Change a value here and both sides pick it up, so the API contract never drifts.
 */

/** Working title. The extension manifest name and UI copy read from this one value. */
export const APP_NAME = 'Outreach Personalizer';

export const API_PREFIX = '/api/v1';

/** Maximum characters of page, selected or pasted text sent to the backend (keeps AI calls inside the token budget). */
export const PAGE_TEXT_CAP = 6000;

export const VOICE_SAMPLE_MAX_COUNT = 3;
export const VOICE_SAMPLE_MAX_CHARS = 1500;

/** Upper bounds for user editable fields, so a single request can never blow the token budget. */
export const FIELD_LIMITS = {
  name: 120,
  role: 160,
  company: 160,
  bio: 600,
  detail: 400,
  email: 254,
  subject: 200,
  body: 5000,
  footer: 500,
  senderOffer: 400,
  url: 2048,
  title: 300,
  search: 100,
} as const;

/** Page size bounds for cursor pagination on GET /prospects. */
export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;
