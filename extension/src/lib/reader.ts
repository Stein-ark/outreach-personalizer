/**
 * Collecting from the current tab when the user clicks the extension icon, its menu item or its shortcut.
 * Those clicks grant activeTab, which is what allows the collector to be injected, even with automatic
 * collection off. Only the one clicked tab is touched.
 */
import { COLLECT_MAX_EMAILS } from '@op/shared';
import { BLOCKED_HOSTS, RESTRICTED_HOSTS } from '../config';
import { collectEmailsInjected } from './collector';

export type UrlClass = 'ok' | 'restricted' | 'blocked';

const hostMatches = (host: string, list: readonly string[]) => list.some((h) => host === h || host.endsWith(`.${h}`));

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

export type TabCollect =
  | { ok: true; url: string; title: string; emails: string[] }
  | { ok: false; reason: 'restricted' | 'blocked' | 'failed'; title: string | null };

/** Finds the addresses on one tab. The injected result is untrusted (the page controls the DOM), so it is checked. */
export async function collectFromTab(tab: { id?: number; url?: string; title?: string }): Promise<TabCollect> {
  const title = tab.title ?? null;
  if (tab.id === undefined) return { ok: false, reason: 'failed', title };
  const kind = classifyUrl(tab.url);
  if (kind !== 'ok') return { ok: false, reason: kind, title };
  try {
    const [first] = await browser.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: 'ISOLATED',
      func: collectEmailsInjected,
      args: [COLLECT_MAX_EMAILS],
    });
    const emails = Array.isArray(first?.result) ? first.result.filter((e): e is string => typeof e === 'string' && e.length <= 254).slice(0, COLLECT_MAX_EMAILS) : null;
    if (!emails) return { ok: false, reason: 'failed', title };
    return { ok: true, url: tab.url!, title: (title ?? '').slice(0, 300), emails };
  } catch {
    return { ok: false, reason: 'failed', title };
  }
}
