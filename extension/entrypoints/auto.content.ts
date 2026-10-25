/**
 * Automatic collection content script. It is not in the manifest: it is registered at runtime only while the user has
 * automatic collection turned on (src/lib/autoCollect.ts). It never sees tokens, and no page text leaves the browser:
 * it sends only {email, name} pairs to the service worker, which saves them.
 */
import type { CollectMessage } from '../src/lib/messages';
import { collectPeople, mayCollect } from '../src/lib/collector';

export default defineContentScript({
  registration: 'runtime',
  matches: [],
  runAt: 'document_idle',
  main() {
    if (window.top !== window || !mayCollect(document, location)) return;
    const sent = new Set<string>();
    const run = () => {
      const fresh = collectPeople(document).filter((p) => !sent.has(p.email));
      if (fresh.length === 0) return;
      fresh.forEach((p) => sent.add(p.email));
      const message: CollectMessage = { type: 'op:collected', url: location.href, title: document.title.slice(0, 300), people: fresh };
      void browser.runtime.sendMessage(message).catch(() => undefined);
    };
    run();
    // Many sites render their team or contact section after load. One more look a few seconds later catches it.
    setTimeout(run, 4000);
  },
});
