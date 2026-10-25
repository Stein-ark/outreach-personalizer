/**
 * Extension configuration. Values that change per deployment come from WXT env files (see DOCS.md).
 */

/** Backend origin, from WXT_API_BASE_URL in .env.development or .env.production. */
export const API_BASE_URL: string = import.meta.env.WXT_API_BASE_URL;

/**
 * Hosts where reading the whole page is disabled by default. A host matches itself and all its subdomains.
 * LinkedIn's help pages say third party extensions that scrape its pages are not permitted, even on click,
 * and accounts can be restricted. Selected text and pasted text still work on these hosts.
 */
export const BLOCKED_HOSTS: readonly string[] = ['linkedin.com'];

/**
 * Automatic collection never runs on these (plus BLOCKED_HOSTS, private network addresses, and any page with a password,
 * card number or one time code field). They hold the user's own private mail, accounts and payments.
 */
export const NEVER_COLLECT_HOSTS: readonly string[] = [
  'mail.google.com',
  'accounts.google.com',
  'drive.google.com',
  'docs.google.com',
  'calendar.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'mail.yahoo.com',
  'mail.proton.me',
  'icloud.com',
  'web.whatsapp.com',
  'messenger.com',
  'slack.com',
  'paypal.com',
  'stripe.com',
  'wise.com',
  'revolut.com',
];

/** Hosts Chrome never lets extensions script (the Web Store). */
export const RESTRICTED_HOSTS: readonly string[] = ['chromewebstore.google.com', 'chrome.google.com'];

export const REQUEST_TIMEOUT_MS = 20_000;
/** AI routes may queue on the server limiter (up to 15 s) and retry once, so they get a longer timeout. */
export const AI_REQUEST_TIMEOUT_MS = 75_000;
