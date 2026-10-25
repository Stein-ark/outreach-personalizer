/**
 * Finding email addresses on a page. collectEmailsInjected is self-contained (no imports, nothing from outside its
 * body), because it runs two ways: called by the automatic content script, and injected on demand with
 * chrome.scripting.executeScript when the user clicks the extension icon. It returns only addresses, never page text.
 */
import { BLOCKED_HOSTS, NEVER_COLLECT_HOSTS } from '../config';

export function collectEmailsInjected(max: number): string[] {
  const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  const VALID = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
  // File names like logo@2x.png look like emails.
  const NOT_AN_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;
  const isHidden = (el: Element): boolean => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true') return true;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return true;
    }
    return false;
  };
  const found = new Set<string>();
  const add = (raw: string) => {
    const email = raw.trim().toLowerCase();
    if (found.size < max && email.length <= 254 && VALID.test(email) && !NOT_AN_EMAIL.test(email)) found.add(email);
  };

  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:" i]'))) {
    if (found.size >= max) break;
    if (isHidden(a)) continue;
    try {
      decodeURIComponent(a.getAttribute('href')!.slice(7).split('?')[0]!).split(',').forEach(add);
    } catch {
      // A malformed mailto link is skipped.
    }
  }

  // Addresses written as plain text. Pages often split an address into several pieces (search engines bold the words
  // you searched for, sites style the domain), so the visible text is rebuilt the way it reads before matching:
  // pieces inside the same block are joined, and blocks are separated by line breaks.
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA|INPUT|SELECT|OPTION)$/;
  const hiddenCache = new Map<Element, boolean>();
  const hidden = (el: Element): boolean => {
    let v = hiddenCache.get(el);
    if (v === undefined) {
      const cs = getComputedStyle(el);
      v = el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true' || cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0 || (el.parentElement ? hidden(el.parentElement) : false);
      hiddenCache.set(el, v);
    }
    return v;
  };
  const INLINE_TAGS = /^(A|ABBR|B|BDI|BDO|CITE|CODE|DATA|DFN|EM|FONT|I|KBD|MARK|Q|S|SAMP|SMALL|SPAN|STRONG|SUB|SUP|TIME|U|VAR|WBR)$/;
  const blockCache = new Map<Element, Element>();
  const blockOf = (el: Element): Element => {
    let b = blockCache.get(el);
    if (!b) {
      const display = getComputedStyle(el).display;
      const inline = display === 'inline' || display === 'contents' || (display === '' && INLINE_TAGS.test(el.tagName));
      b = inline && el.parentElement ? blockOf(el.parentElement) : el;
      blockCache.set(el, b);
    }
    return b;
  };
  let text = '';
  let lastBlock: Element | null = null;
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const piece = node.textContent ?? '';
    const parent = node.parentElement;
    if (!piece || !parent || SKIP.test(parent.tagName) || hidden(parent)) continue;
    const block = blockOf(parent);
    if (block !== lastBlock) text += '\n';
    // Within a block, pieces join directly only when they can continue an address (for example "usa@" then "gmail"
    // then ".com"). A piece starting with a capital or a space, such as a "Read more" link after a cut off address,
    // stays separate, so it never becomes part of one.
    else if (!(/[a-z0-9@._%+-]$/i.test(text) && /^[a-z0-9@._%+-]/.test(piece))) text += ' ';
    text += piece;
    lastBlock = block;
    if (text.length > 2_000_000) break;
  }
  for (const match of text.match(EMAIL) ?? []) {
    if (found.size >= max) break;
    add(match.replace(/\.+$/, ''));
  }
  return [...found];
}

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
