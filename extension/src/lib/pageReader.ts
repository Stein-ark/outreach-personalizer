/**
 * The function injected into the active tab with chrome.scripting.executeScript, in the isolated world.
 *
 * Chrome serializes this function's source and runs it inside the page, so it must be completely self-contained:
 * no imports, no references to anything outside its body. It never sees tokens or any extension state.
 * It returns only the fields listed in the PageSnapshot schema, never raw HTML.
 */
import type { PageSnapshot } from '@op/shared';

export function readPageInjected(maxChars: number): PageSnapshot {
  const clip = (value: string | null | undefined, max: number): string | null => {
    if (typeof value !== 'string') return null;
    const v = value.replace(/\s+/g, ' ').trim();
    return v ? v.slice(0, max) : null;
  };
  const meta = (selector: string) => clip(document.querySelector<HTMLMetaElement>(selector)?.content, 500);
  const emailRe = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i;

  // JSON-LD Person and Organization entities, including ones nested in @graph or mainEntity.
  const jsonLd: PageSnapshot['jsonLd'] = [];
  const str = (v: unknown, max = 500): string | null => {
    if (typeof v === 'string') return clip(v, max);
    if (Array.isArray(v)) return str(v[0], max);
    if (v && typeof v === 'object' && 'name' in v) return str((v as { name: unknown }).name, max);
    return null;
  };
  const visit = (node: unknown, depth: number): void => {
    if (depth > 4 || jsonLd.length >= 10 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, depth + 1));
      return;
    }
    const o = node as Record<string, unknown>;
    const types = ([] as unknown[]).concat(o['@type'] ?? []).map(String);
    const type = types.includes('Person') ? 'Person' : types.some((t) => /Organization|Corporation/.test(t)) ? 'Organization' : null;
    if (type) {
      const email = str(o.email, 254)?.replace(/^mailto:/i, '') ?? null;
      jsonLd.push({
        type,
        name: str(o.name),
        jobTitle: str(o.jobTitle),
        worksFor: str(o.worksFor),
        description: str(o.description, 1000),
        email: email && emailRe.test(email) ? email : null,
      });
    }
    for (const key of ['@graph', 'mainEntity', 'author', 'founder']) visit(o[key], depth + 1);
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      visit(JSON.parse(s.textContent ?? ''), 0);
    } catch {
      // Malformed JSON-LD is common, skip it.
    }
  });

  // Visibility: anything a person cannot see is skipped, which also drops most hidden prompt injection text.
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'CANVAS', 'NAV', 'FOOTER', 'FORM', 'BUTTON', 'SELECT', 'TEXTAREA', 'INPUT', 'OBJECT', 'VIDEO', 'AUDIO']);
  const SKIP_ROLES = new Set(['navigation', 'contentinfo', 'dialog', 'alertdialog', 'search', 'menu', 'menubar']);
  const BANNER_RE = /cookie|consent|gdpr|onetrust|cmp-|truste|privacy-banner/i;
  const isHidden = (el: Element): boolean => {
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('inert')) return true;
    const role = el.getAttribute('role');
    if (role && SKIP_ROLES.has(role)) return true;
    if (BANNER_RE.test(`${el.id} ${typeof el.className === 'string' ? el.className : ''}`)) return true;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
    if (parseFloat(cs.opacity) === 0) return true;
    if (cs.fontSize && parseFloat(cs.fontSize) < 2) return true;
    if ((cs.position === 'absolute' || cs.position === 'fixed') && (parseFloat(cs.left) < -999 || parseFloat(cs.top) < -999)) return true;
    if (/rect\(0(px)?,?\s*0(px)?,?\s*0(px)?,?\s*0(px)?\)/.test(cs.clip) || cs.clipPath === 'inset(50%)') return true;
    return false;
  };
  const BLOCK_TAGS = /^(P|DIV|SECTION|ARTICLE|LI|UL|OL|H[1-6]|BR|TR|TABLE|BLOCKQUOTE|HEADER|MAIN|ASIDE|DL|DT|DD|FIGCAPTION)$/;

  const collect = (root: Element, limit: number): string => {
    const parts: string[] = [];
    let length = 0;
    let visited = 0;
    const walk = (el: Element): void => {
      if (length >= limit || visited++ > 20_000 || isHidden(el)) return;
      const block = BLOCK_TAGS.test(el.tagName.toUpperCase());
      if (block) parts.push('\n');
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = (child.textContent ?? '').replace(/\s+/g, ' ');
          if (t.trim()) {
            parts.push(t);
            length += t.length;
          }
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child as Element);
        }
      }
      if (block) parts.push('\n');
    };
    walk(root);
    return parts
      .join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  // Prefer the main content region when it holds real text, otherwise read the whole body.
  const body = document.body;
  const main = document.querySelector('main, [role="main"], article');
  const raw = body ? collect(main && collect(main, 400).length >= 200 ? main : body, maxChars + 500) : '';
  let text = raw;
  const textTruncated = raw.length > maxChars;
  if (textTruncated) {
    const cut = raw.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(' ');
    text = lastSpace > maxChars * 0.8 ? cut.slice(0, lastSpace) : cut;
  }

  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .filter((h) => {
      for (let el: Element | null = h; el; el = el.parentElement) if (isHidden(el)) return false;
      return true;
    })
    .map((h) => clip(h.textContent, 300))
    .filter((h): h is string => h !== null)
    .slice(0, 40);

  const mailtos = Array.from(
    new Set(
      Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:" i]'))
        .flatMap((a) => {
          try {
            return decodeURIComponent(a.getAttribute('href')!.slice(7).split('?')[0]!).split(',');
          } catch {
            return [];
          }
        })
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length <= 254 && emailRe.test(e)),
    ),
  ).slice(0, 10);

  return {
    url: location.href.slice(0, 2048),
    title: (clip(document.title, 300) ?? ''),
    description: meta('meta[name="description" i]'),
    og: {
      title: meta('meta[property="og:title"]'),
      description: meta('meta[property="og:description"]'),
      siteName: meta('meta[property="og:site_name"]'),
      type: meta('meta[property="og:type"]'),
    },
    jsonLd,
    headings,
    mailtos,
    text,
    textTruncated,
  };
}
