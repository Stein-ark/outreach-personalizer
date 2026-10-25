/**
 * Turning automatic collection on and off. All sites access is an optional permission: it is requested only when the
 * user turns collection on (from a click in Settings) and removed when they turn it off, so the default install keeps
 * the minimal permissions.
 */
import { z } from 'zod';
import { BLOCKED_HOSTS, NEVER_COLLECT_HOSTS } from '../config';
import { getStored, setStored } from './storage';

export const AUTO_KEY = 'autoCollect';
export const AutoSetting = z.object({ enabled: z.boolean() });

const ORIGINS = ['https://*/*', 'http://*/*'];
const SCRIPT_ID = 'op-auto-collect';
/** WXT builds entrypoints/auto.content.ts to this path. */
const SCRIPT_FILE = 'content-scripts/auto.js';

const excludeMatches = () => [...BLOCKED_HOSTS, ...NEVER_COLLECT_HOSTS].flatMap((h) => [`*://${h}/*`, `*://*.${h}/*`]);

async function isRegistered(): Promise<boolean> {
  return (await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })).length > 0;
}

async function register(): Promise<void> {
  if (await isRegistered()) return;
  await browser.scripting.registerContentScripts([
    { id: SCRIPT_ID, matches: ORIGINS, excludeMatches: excludeMatches(), js: [SCRIPT_FILE], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true },
  ]);
}

async function unregister(): Promise<void> {
  if (await isRegistered()) await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
}

/** Must be called from a user click: Chrome only shows the permission prompt in response to a gesture. */
export async function enableAutoCollect(): Promise<boolean> {
  const granted = await browser.permissions.request({ origins: ORIGINS });
  if (!granted) return false;
  await register();
  await setStored('local', AUTO_KEY, { enabled: true });
  return true;
}

export async function disableAutoCollect(): Promise<void> {
  await unregister();
  await setStored('local', AUTO_KEY, { enabled: false });
  await browser.permissions.remove({ origins: ORIGINS }).catch(() => false);
}

export async function isAutoCollectOn(): Promise<boolean> {
  return (await getStored('local', AUTO_KEY, AutoSetting))?.enabled === true;
}

/** Called when the service worker starts: keeps the registration in line with the setting and the permission. */
export async function syncAutoCollect(): Promise<void> {
  const enabled = await isAutoCollectOn();
  const permitted = await browser.permissions.contains({ origins: ORIGINS });
  if (enabled && permitted) await register();
  else {
    await unregister();
    // The user removed site access from chrome://extensions, so the setting follows.
    if (enabled) await setStored('local', AUTO_KEY, { enabled: false });
  }
}
