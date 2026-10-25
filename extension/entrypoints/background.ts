/**
 * Service worker. It holds no state in globals (Chrome may stop it at any time).
 *
 * Gesture rule: sidePanel.open() and activeTab need a direct user gesture on the extension, and Chrome only honours it
 * for synchronous calls, so sidePanel.open() is called first, before any await. The click then collects the page's
 * email addresses right away (activeTab allows it), whether or not automatic collection is on.
 */
import { api } from '../src/lib/api';
import { isAutoCollectOn, syncAutoCollect } from '../src/lib/autoCollect';
import { LAST_COLLECT_KEY, type LastCollect } from '../src/lib/lastCollect';
import { CollectMessage } from '../src/lib/messages';
import { collectFromTab } from '../src/lib/reader';
import { runSheetCheck } from '../src/lib/sheets';

const MENU_COLLECT = 'op-collect-page';
const SHEETS_ALARM = 'op-sheets';

type Tab = Browser.tabs.Tab;

/** Saves addresses from one page, shows the count on the icon for that tab, then downloads any sheet that is ready. */
async function save(tabId: number, url: string, title: string | null, emails: string[]): Promise<{ added: number } | null> {
  try {
    const res = await api.collect({ url, title, emails });
    await browser.action.setBadgeBackgroundColor({ tabId, color: '#0F7A64' });
    await browser.action.setBadgeText({ tabId, text: String(Math.min(emails.length, 99)) });
    await browser.action.setTitle({ tabId, title: `${emails.length} email addresses on this page (${res.added} new in your list)` });
    await runSheetCheck().catch(() => undefined);
    return res;
  } catch {
    // Not signed in, offline or server down: nothing is saved, and nothing else is affected.
    await browser.action.setTitle({ tabId, title: 'Not saved: open the panel and sign in, or check the server' }).catch(() => undefined);
    return null;
  }
}

async function collectNow(tab: Tab): Promise<void> {
  const result = await collectFromTab(tab);
  let notice: LastCollect;
  if (!result.ok) notice = { at: Date.now(), title: result.title, outcome: result.reason, found: 0, added: 0 };
  else if (result.emails.length === 0) notice = { at: Date.now(), title: result.title, outcome: 'none', found: 0, added: 0 };
  else {
    const saved = await save(tab.id!, result.url, result.title || null, result.emails);
    notice = { at: Date.now(), title: result.title, outcome: saved ? 'saved' : 'signed_out', found: result.emails.length, added: saved?.added ?? 0 };
  }
  await browser.storage.session.set({ [LAST_COLLECT_KEY]: notice });
}

function openAndCollect(tab: Tab | undefined): void {
  if (!tab || tab.id === undefined) return;
  // Synchronous call inside the gesture. Nothing is awaited before this line.
  const opening = browser.sidePanel.open({ windowId: tab.windowId });
  void collectNow(tab).finally(() => opening.catch(() => undefined));
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    // Explicitly off: the action click is handled below so the page can be collected inside the same gesture.
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    void syncAutoCollect().catch(() => undefined);
    void browser.alarms.create(SHEETS_ALARM, { periodInMinutes: 1 });
    browser.contextMenus.removeAll(() => {
      browser.contextMenus.create({ id: MENU_COLLECT, title: 'Collect emails on this page', contexts: ['page', 'selection', 'link'] });
    });
  });

  browser.runtime.onStartup.addListener(() => {
    void syncAutoCollect().catch(() => undefined);
    void browser.alarms.create(SHEETS_ALARM, { periodInMinutes: 1 });
  });

  // Once a minute: download any sheet that is full, or about to be deleted.
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SHEETS_ALARM) void runSheetCheck().catch(() => undefined);
  });

  // The toolbar icon and the _execute_action shortcut (there is no popup), and the menu item.
  browser.action.onClicked.addListener(openAndCollect);
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_COLLECT) openAndCollect(tab);
  });

  // The only message accepted: the automatic collector, from this extension's own content script, in a tab's top
  // frame. Anything from web pages, other extensions or subframes, or with any other shape, is ignored.
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id !== browser.runtime.id || sender.tab?.id === undefined || sender.frameId !== 0) return;
    const parsed = CollectMessage.safeParse(message);
    if (!parsed.success || !/^https?:\/\//.test(parsed.data.url)) return;
    const tabId = sender.tab.id;
    void isAutoCollectOn().then((on) => (on ? save(tabId, parsed.data.url, parsed.data.title || null, parsed.data.emails) : null));
  });
});
