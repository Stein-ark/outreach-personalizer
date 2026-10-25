/**
 * URL normalization used as the dedupe key for saved prospects.
 * Two visits to the same page with different tracking parameters must map to one prospect.
 */

/** Query parameters that only track the visit and never change the page content. */
const TRACKING_PARAMS = new Set([
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'twclid',
  'li_fat_id',
  'mc_cid',
  'mc_eid',
  'igshid',
  'yclid',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
  'ref',
  'ref_src',
  'ref_url',
  'referrer',
  'si',
  'trk',
  'trkInfo',
  'vero_id',
  'oly_anon_id',
  'oly_enc_id',
  'spm',
]);

const TRACKING_PREFIXES = ['utm_', 'pk_', 'mtm_', 'hsa_'];

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return TRACKING_PARAMS.has(lower) || TRACKING_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * Returns a canonical http(s) URL string, or null when the input is not an http(s) URL.
 * Lowercases the host, drops the fragment, default ports, tracking parameters and a trailing slash,
 * and sorts the remaining parameters so their order does not matter.
 */
export function normalizeUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  url.username = '';
  url.password = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');

  const kept = [...url.searchParams.entries()].filter(([k]) => !isTrackingParam(k));
  kept.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  url.search = new URLSearchParams(kept).toString();

  let out = url.toString();
  // A bare origin keeps its slash ("https://a.com/"), deeper paths lose a trailing one.
  if (url.pathname.length > 1 && url.pathname.endsWith('/') && !url.search) out = out.slice(0, -1);
  return out;
}
