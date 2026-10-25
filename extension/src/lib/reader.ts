/**
 * Reading a tab on demand. Used by the service worker right after a user gesture (action click, context menu,
 * shortcut) and by the panel's "Re-read page" button. Only ever touches the one tab it is given.
 */
import { z } from 'zod';
import { PAGE_TEXT_CAP, PageSnapshot } from '@op/shared';
import { BLOCKED_HOSTS, RESTRICTED_HOSTS } from '../config';
import { readPageInjected } from './pageReader';

export const ReadFailure = z.enum(['restricted', 'blocked', 'empty', 'no_access', 'failed']);
export type ReadFailure = z.infer<typeof ReadFailure>;

export const ReadResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), mode: z.enum(['page', 'selection']), tabId: z.number().int(), snapshot: PageSnapshot }),
  z.object({
    ok: z.literal(false),
    reason: ReadFailure,
    tabId: z.number().int().nullable(),
    url: z.string().nullable(),
    title: z.string().nullable(),
  }),
]);
export type ReadResult = z.infer<typeof ReadResult>;

const hostMatches = (host: string, list: readonly string[]) => list.some((h) => host === h || host.endsWith(`.${h}`));

export type UrlClass = 'ok' | 'restricted' | 'blocked';

export function classifyUrl(raw: string | undefined): UrlClass {
  if (!raw) return 'restricted';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'restricted';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'restricted';
  const host = url.hostname.toLowerCase();
  if (hostMatches(host, RESTRICTED_HOSTS)) return 'restricted';
  // Chrome shows PDFs in its own viewer, which extensions cannot script.
  if (/\.pdf$/i.test(url.pathname)) return 'restricted';
  if (hostMatches(host, BLOCKED_HOSTS)) return 'blocked';
  return 'ok';
}

interface TabLike {
  id?: number;
  url?: string;
  title?: string;
}

const failure = (reason: ReadFailure, tab: TabLike): ReadResult => ({
  ok: false,
  reason,
  tabId: tab.id ?? null,
  url: tab.url ?? null,
  title: tab.title ?? null,
});

/**
 * Reads the main frame of one tab. tab.url is only visible while the extension has activeTab access to the tab,
 * so a missing URL means the user has not invoked the extension on this page yet.
 */
export async function readTab(tab: TabLike): Promise<ReadResult> {
  if (tab.id === undefined) return failure('failed', tab);
  if (tab.url === undefined) return failure('no_access', tab);
  const kind = classifyUrl(tab.url);
  if (kind !== 'ok') return failure(kind, tab);

  let results;
  try {
    results = await browser.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: 'ISOLATED',
      func: readPageInjected,
      args: [PAGE_TEXT_CAP],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(/permission|cannot access|must request/i.test(message) ? 'no_access' : /cannot be scripted|extensions gallery|chrome:\/\//i.test(message) ? 'restricted' : 'failed', tab);
  }

  // The injected result is untrusted (the page could tamper with the DOM it reads), so its shape is validated.
  const first = results?.[0];
  const parsed = PageSnapshot.safeParse(first?.result);
  if (!first || first.frameId !== 0 || !parsed.success) return failure('failed', tab);
  if (parsed.data.text.trim().length < 40 && parsed.data.jsonLd.length === 0) return failure('empty', tab);
  return { ok: true, mode: 'page', tabId: tab.id, snapshot: parsed.data };
}

/** Builds a result from text the user selected (context menu). The page itself is not scripted. */
export function selectionResult(tab: TabLike, selectionText: string | undefined): ReadResult {
  const text = (selectionText ?? '').trim().slice(0, PAGE_TEXT_CAP);
  if (tab.id === undefined) return failure('failed', tab);
  if (text.length < 20) return failure('empty', tab);
  const url = tab.url && classifyUrl(tab.url) !== 'restricted' ? tab.url : null;
  return {
    ok: true,
    mode: 'selection',
    tabId: tab.id,
    snapshot: {
      url: url ?? '',
      title: (tab.title ?? '').slice(0, 300),
      description: null,
      og: { title: null, description: null, siteName: null, type: null },
      jsonLd: [],
      headings: [],
      mailtos: [],
      text,
      textTruncated: (selectionText ?? '').trim().length > PAGE_TEXT_CAP,
    },
  };
}
