/**
 * Automatic collection content script. It is not in the manifest: it is registered at runtime only while the user has
 * automatic collection turned on (src/lib/autoCollect.ts). It never sees tokens. It sends only the email addresses
 * found on the page to the service worker, which saves them.
 */
import { COLLECT_MAX_EMAILS } from '@op/shared/config';
import type { CollectMessage } from '../src/lib/messages';
import { collectEmailsInjected, mayCollect } from '../src/lib/collector';

export default defineContentScript({
  registration: 'runtime',
  matches: [],
  runAt: 'document_idle',
  main() {
    if (window.top !== window || !mayCollect(document, location)) return;
    const sent = new Set<string>();
    const run = () => {
      const fresh = collectEmailsInjected(COLLECT_MAX_EMAILS).filter((e) => !sent.has(e));
      if (fresh.length === 0) return;
      fresh.forEach((e) => sent.add(e));
      const message: CollectMessage = { type: 'op:collected', url: location.href, title: document.title.slice(0, 300), emails: fresh };
      void browser.runtime.sendMessage(message).catch(() => undefined);
    };
    run();
    // Many sites render their contact or team section after load. One more look a few seconds later catches it.
    setTimeout(run, 4000);
  },
});
