/**
 * Service worker. It holds no state in globals (Chrome may stop it at any time) and never touches tokens.
 *
 * Gesture rule: activeTab and sidePanel.open() both need a direct user gesture on the extension. Chrome only
 * honours the gesture for synchronous calls, so sidePanel.open() is called first, before any await, and the
 * page is read immediately after while the activeTab grant is fresh. The result is handed to the panel through
 * chrome.storage.session, which works whether or not the panel has finished loading.
 */
import { PENDING_READ_KEY, type PendingRead } from '../src/lib/work';
import { api } from '../src/lib/api';
import { isAutoCollectOn, syncAutoCollect } from '../src/lib/autoCollect';
import { CollectMessage } from '../src/lib/messages';
import { readTab, selectionResult, type ReadResult } from '../src/lib/reader';

const MENU_PAGE = 'op-draft-page';
const MENU_SELECTION = 'op-draft-selection';

type Tab = Browser.tabs.Tab;

async function deliver(result: ReadResult): Promise<void> {
  const pending: PendingRead = { at: Date.now(), result };
  await browser.storage.session.set({ [PENDING_READ_KEY]: pending });
}

function openThenRead(tab: Tab | undefined, read: (tab: Tab) => Promise<ReadResult> | ReadResult): void {
  if (!tab || tab.id === undefined) return;
  // Synchronous call inside the gesture. The promise is awaited later, never before this line.
  const opening = browser.sidePanel.open({ windowId: tab.windowId });
  void (async () => {
    // Reading, delivering and opening are independent: a failure in one never stops the others, and the panel is
    // always told something, even if reading threw unexpectedly.
    let result: ReadResult;
    try {
      result = await read(tab);
    } catch {
      result = { ok: false, reason: 'failed', tabId: tab.id ?? null, url: tab.url ?? null, title: tab.title ?? null };
    }
    await deliver(result).catch(() => undefined);
    await opening.catch(() => undefined);
  })();
}

/** Saves people found by the automatic collector and shows the count on the toolbar icon for that tab. */
async function saveCollected(tabId: number, message: CollectMessage): Promise<void> {
  if (!(await isAutoCollectOn()) || !/^https?:\/\//.test(message.url)) return;
  const count = String(Math.min(message.people.length, 99));
  try {
    const res = await api.collect({ url: message.url, title: message.title || null, people: message.people });
    await browser.action.setBadgeBackgroundColor({ tabId, color: '#0F7A64' });
    await browser.action.setBadgeText({ tabId, text: count });
    await browser.action.setTitle({ tabId, title: `${message.people.length} people picked up on this page (${res.added} new in your Saved list)` });
  } catch {
    // Not signed in, offline or server down: collection simply does not happen. Nothing else is affected.
    await browser.action.setTitle({ tabId, title: 'Automatic collection paused: open the panel and sign in, or check the server' }).catch(() => undefined);
  }
}

export default defineBackground(() => {
  // Keep the collector's registration in line with the setting and the site access permission.
  browser.runtime.onStartup.addListener(() => void syncAutoCollect().catch(() => undefined));

  // The only message accepted: the collector, from this extension's own content script, in a tab's top frame.
  // Anything from web pages, other extensions or subframes, or with any other shape, is ignored.
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id !== browser.runtime.id || sender.tab?.id === undefined || sender.frameId !== 0) return;
    const parsed = CollectMessage.safeParse(message);
    if (parsed.success) void saveCollected(sender.tab.id, parsed.data);
  });

  browser.runtime.onInstalled.addListener(() => {
    // Explicitly off: the action click is handled below so the page can be read inside the same gesture.
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    void syncAutoCollect().catch(() => undefined);
    browser.contextMenus.removeAll(() => {
      browser.contextMenus.create({ id: MENU_PAGE, title: 'Draft outreach for this page', contexts: ['page'] });
      browser.contextMenus.create({ id: MENU_SELECTION, title: 'Draft outreach from selected text', contexts: ['selection'] });
    });
  });

  // Fires for the toolbar icon and the _execute_action keyboard shortcut (there is no popup).
  browser.action.onClicked.addListener((tab) => openThenRead(tab, readTab));

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_PAGE) openThenRead(tab, readTab);
    else if (info.menuItemId === MENU_SELECTION) openThenRead(tab, (t) => selectionResult(t, info.selectionText));
  });
});
