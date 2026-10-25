import { describe, expect, it } from 'vitest';
import { SHEET_SIZE, type SheetSummary } from '@op/shared';
import { EXPIRY_MARGIN_MS, sheetFileName, sheetsToDownload } from '../src/lib/sheets';

const now = Date.UTC(2026, 9, 25, 12, 0, 0);
const sheet = (over: Partial<SheetSummary>): SheetSummary => ({
  number: 1,
  total: 10,
  drafted: 0,
  oldestExpiresAt: new Date(now + 2 * 3_600_000).toISOString(),
  current: true,
  ...over,
});

describe('sheetsToDownload', () => {
  it('downloads a full sheet straight away, drafted or not', () => {
    expect(sheetsToDownload([sheet({ total: SHEET_SIZE })], [], now)).toHaveLength(1);
  });

  it('does not download a sheet that is still filling up', () => {
    expect(sheetsToDownload([sheet({ total: 120 })], [], now)).toHaveLength(0);
  });

  it('downloads early when the oldest person is about to be deleted, so nothing is lost', () => {
    const expiring = sheet({ total: 40, oldestExpiresAt: new Date(now + EXPIRY_MARGIN_MS - 1000).toISOString() });
    expect(sheetsToDownload([expiring], [], now)).toHaveLength(1);
  });

  it('never downloads the same sheet twice by itself', () => {
    expect(sheetsToDownload([sheet({ total: SHEET_SIZE })], [1], now)).toHaveLength(0);
  });

  it('names files in order inside one folder', () => {
    expect(sheetFileName(7)).toBe('Outreach Personalizer/sheet-007.xlsx');
  });
});
