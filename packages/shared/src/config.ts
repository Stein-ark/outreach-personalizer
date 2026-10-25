/**
 * Product wide constants shared by the extension and the server.
 * Change a value here and both sides pick it up, so the API contract never drifts.
 */

/** Working title. The extension manifest name and UI copy read from this one value. */
export const APP_NAME = 'Outreach Personalizer';

export const API_PREFIX = '/api/v1';

/** Upper bounds for user editable fields, so a single request can never blow the token budget. */
export const FIELD_LIMITS = {
  name: 120,
  email: 254,
  subject: 200,
  body: 5000,
  /** What the user wants their message to say, typed when drafting. */
  message: 1000,
  url: 2048,
  title: 300,
  search: 100,
} as const;

/** Maximum email addresses saved from one page. */
export const COLLECT_MAX_EMAILS = 50;

/** Emails per spreadsheet. The sheet downloads by itself when full, and a new one starts. */
export const SHEET_SIZE = 200;

/** Page size bounds for cursor pagination on GET /prospects. */
export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;
