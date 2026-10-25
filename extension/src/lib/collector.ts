/**
 * Automatic collection: finds every visible email address on a page and the person's name next to it.
 * Runs in the content script. It reads the DOM locally and returns only {email, name} pairs. No page text leaves
 * the browser, and no AI is involved.
 */
import { COLLECT_MAX_PEOPLE } from '@op/shared/config';
import type { CollectedPerson } from '@op/shared';
import { BLOCKED_HOSTS, NEVER_COLLECT_HOSTS } from '../config';
import { PERSON_NAME } from './names';

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
/** Addresses that belong to an organisation or a machine, not a person to contact. Still collected, never named. */
const ROLE_ACCOUNT = /^(info|hello|contact|press|media|support|help|admin|team|office|careers|jobs|hr|sales|billing|privacy|legal|noreply|no-reply|donotreply|webmaster|abuse|security)@/i;
/** File names like image@2x.png look like emails. */
const NOT_AN_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;

const hostMatches = (host: string, list: readonly string[]) => list.some((h) => host === h || host.endsWith(`.${h}`));

/** Whether automatic collection may run on this page at all. */
export function mayCollect(doc: Document, loc: { protocol: string; hostname: string }): boolean {
  if (loc.protocol !== 'https:' && loc.protocol !== 'http:') return false;
  const host = loc.hostname.toLowerCase();
  if (hostMatches(host, BLOCKED_HOSTS) || hostMatches(host, NEVER_COLLECT_HOSTS)) return false;
  if (host === 'localhost' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.endsWith('.local')) return false;
  // Sign in, payment and account pages: never touched.
  if (doc.querySelector('input[type="password"], input[autocomplete="cc-number"], input[autocomplete="one-time-code"]')) return false;
  return true;
}

function isHidden(el: Element): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true') return true;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return true;
  }
  return false;
}

/** The first name-like line in a block of text. Addresses are cut out first, so "Ana Diaz ana@x.com" still yields Ana Diaz. */
function nameIn(text: string): string | null {
  for (const line of text.replace(EMAIL, '\n').split(/\n|\s{2,}|[|,•·:]/)) {
    const t = line.trim();
    if (t.length <= 60 && PERSON_NAME.test(t)) return t;
  }
  return null;
}

/** Looks around an element for the person's name: the link text, then up to four enclosing blocks of modest size. */
function nameNear(el: Element, email: string): string | null {
  if (ROLE_ACCOUNT.test(email)) return null;
  const own = nameIn(el.textContent ?? '');
  if (own) return own;
  let block: Element | null = el.parentElement;
  for (let depth = 0; block && depth < 4; depth++, block = block.parentElement) {
    const text = (block as HTMLElement).innerText ?? block.textContent ?? '';
    // A block holding several addresses is a list, not one person's card. Stop before borrowing a neighbour's name.
    if (text.length > 400 || (text.match(EMAIL) ?? []).length > 1) break;
    const found = nameIn(text);
    if (found) return found;
  }
  return null;
}

export function collectPeople(doc: Document): CollectedPerson[] {
  const found = new Map<string, CollectedPerson>();
  const add = (raw: string, el: Element) => {
    const email = raw.trim().toLowerCase();
    if (found.has(email) || email.length > 254 || NOT_AN_EMAIL.test(email) || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return;
    found.set(email, { email, name: nameNear(el, email) });
  };

  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:" i]'))) {
    if (found.size >= COLLECT_MAX_PEOPLE) break;
    if (isHidden(a)) continue;
    let addresses: string[] = [];
    try {
      addresses = decodeURIComponent(a.getAttribute('href')!.slice(7).split('?')[0]!).split(',');
    } catch {
      continue;
    }
    addresses.forEach((e) => add(e, a));
  }

  // Addresses written as plain text. Script, style and hidden content is skipped.
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && found.size < COLLECT_MAX_PEOPLE; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    if (!text.includes('@')) continue;
    const parent = node.parentElement;
    if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA|INPUT)$/.test(parent.tagName) || isHidden(parent)) continue;
    for (const match of text.match(EMAIL) ?? []) add(match, parent);
  }

  return [...found.values()].slice(0, COLLECT_MAX_PEOPLE);
}
