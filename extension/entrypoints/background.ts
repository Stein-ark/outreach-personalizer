/**
 * Service worker. It holds no state in globals (Chrome may stop it at any time) and never touches tokens.
 *
 * Gesture rule: activeTab and sidePanel.open() both need a direct user gesture on the extension. Chrome only
 * honours the gesture for synchronous calls, so sidePanel.open() is called first, before any await, and the
 * page is read immediately after while the activeTab grant is fresh. The result is handed to the panel through
 * chrome.storage.session, which works whether or not the panel has finished loading.
 */
import { PENDING_READ_KEY, type PendingRead } from '../src/lib/work';
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
    const result = await read(tab);
    await deliver(result);
    await opening.catch(() => undefined);
  })();
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    // Explicitly off: the action click is handled below so the page can be read inside the same gesture.
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
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
