/**
 * Automatic spreadsheet downloads. Emails fill sheets of SHEET_SIZE on the server. A sheet is downloaded by itself,
 * as an .xlsx in the Downloads folder, as soon as it is full, or earlier when its oldest email is close to being
 * deleted (the 3 hour retention), so nothing is lost. A downloaded current sheet is closed, so new emails start the
 * next one. Drafting is separate and optional: a drafted sheet can be downloaded again from the panel.
 */
import { z } from 'zod';
import { SHEET_SIZE, type SheetSummary } from '@op/shared';
import { api } from './api';
import { REFRESH_KEY, StoredRefresh } from './auth';
import { getStored, setStored } from './storage';

/** Download a sheet when its oldest email has this little time left, even if it is not full. */
export const EXPIRY_MARGIN_MS = 20 * 60_000;
export const SHEETS_FOLDER = 'Outreach Personalizer';

const Downloaded = z.array(z.number().int());
const downloadedKey = (userId: string) => `sheetsDownloaded.${userId}`;

/** Which sheets to download now. Pure, so the rule is unit tested. */
export function sheetsToDownload(items: SheetSummary[], downloaded: readonly number[], now: number): SheetSummary[] {
  return items.filter(
    (s) =>
      s.total > 0 &&
      !downloaded.includes(s.number) &&
      (s.total >= SHEET_SIZE || Date.parse(s.oldestExpiresAt) - now <= EXPIRY_MARGIN_MS),
  );
}

export const sheetFileName = (n: number) => `${SHEETS_FOLDER}/sheet-${String(n).padStart(3, '0')}.xlsx`;

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Saves one sheet to the Downloads folder. Works from the service worker (no DOM), so it uses a data URL. */
export async function downloadSheet(sheet: Pick<SheetSummary, 'number' | 'current'>, userId: string): Promise<void> {
  const bytes = await api.exportSheet(sheet.number);
  await browser.downloads.download({
    url: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${toBase64(bytes)}`,
    filename: sheetFileName(sheet.number),
    conflictAction: 'uniquify',
    saveAs: false,
  });
  if (sheet.current) await api.closeSheet(sheet.number);
  const done = (await getStored('local', downloadedKey(userId), Downloaded)) ?? [];
  await setStored('local', downloadedKey(userId), [...done.filter((n) => n !== sheet.number), sheet.number].slice(-200));
}

export async function downloadedSheets(userId: string): Promise<number[]> {
  return (await getStored('local', downloadedKey(userId), Downloaded)) ?? [];
}

/** Checks the user's sheets and downloads every ready one. Serialized, so the timer and a new page never race. */
export function runSheetCheck(): Promise<void> {
  return navigator.locks.request('op-sheets', async () => {
    const session = await getStored('local', REFRESH_KEY, StoredRefresh);
    if (!session) return;
    const { items } = await api.sheets();
    const ready = sheetsToDownload(items, await downloadedSheets(session.user.id), Date.now());
    for (const sheet of ready) await downloadSheet(sheet, session.user.id);
  });
}
