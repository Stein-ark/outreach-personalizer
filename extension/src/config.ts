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

/** Hosts Chrome never lets extensions script (the Web Store). */
export const RESTRICTED_HOSTS: readonly string[] = ['chromewebstore.google.com', 'chrome.google.com'];

export const REQUEST_TIMEOUT_MS = 20_000;
/** AI routes may queue on the server limiter (up to 15 s) and retry once, so they get a longer timeout. */
export const AI_REQUEST_TIMEOUT_MS = 75_000;
