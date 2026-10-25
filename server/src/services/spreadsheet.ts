/**
 * .xlsx export with SheetJS Community Edition (write only, nothing is ever parsed).
 *
 * Every cell is written as an explicit string cell so nothing is interpreted as a number, date or formula,
 * and every value is neutralized against spreadsheet formula injection as well, because page titles come from
 * untrusted web pages and drafts from AI output, and the user may later re-save the sheet as CSV.
 */
import * as XLSX from 'xlsx';
import type { Prospect } from '@op/shared';

/**
 * Characters that make Excel, LibreOffice or Google Sheets treat a cell as a formula (OWASP CSV injection guidance),
 * plus their full width and small form variants, which some spreadsheet apps also accept.
 */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r', '\n', '＝', '＋', '－', '＠', '﹦', '﹢', '﹣', '﹫']);

/** Prefixes a single quote when the value (or the value after leading spaces) starts with a formula trigger. */
export function neutralizeCell(value: string): string {
  const first = value[0];
  const firstNonSpace = value.trimStart()[0];
  if ((first !== undefined && FORMULA_TRIGGERS.has(first)) || (firstNonSpace !== undefined && FORMULA_TRIGGERS.has(firstNonSpace))) {
    return `'${value}`;
  }
  return value;
}

export const EXPORT_COLUMNS: { header: string; width: number; value: (p: Prospect) => string | null }[] = [
  { header: 'Email', width: 34, value: (p) => p.email },
  { header: 'Status', width: 12, value: (p) => (p.status === 'new' ? 'not contacted' : p.status) },
  { header: 'Date added', width: 18, value: (p) => p.createdAt.slice(0, 16).replace('T', ' ') },
  { header: 'Found on', width: 36, value: (p) => p.sourceTitle },
  { header: 'Source URL', width: 40, value: (p) => p.sourceUrl },
  { header: 'Draft subject', width: 36, value: (p) => p.subject },
  { header: 'Draft body', width: 100, value: (p) => p.body },
];

export function buildProspectWorkbook(prospects: Prospect[]): Buffer {
  const ws: XLSX.WorkSheet = {};
  const rows = [EXPORT_COLUMNS.map((c) => c.header), ...prospects.map((p) => EXPORT_COLUMNS.map((c) => c.value(p) ?? ''))];
  rows.forEach((row, r) => {
    row.forEach((v, c) => {
      ws[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: neutralizeCell(v) };
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: EXPORT_COLUMNS.length - 1 } });
  ws['!cols'] = EXPORT_COLUMNS.map((c) => ({ wch: c.width }));
  // The Community Edition cannot write frozen panes or wrap styles. An autofilter on the header row is supported.
  ws['!autofilter'] = { ref: ws['!ref'] };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Prospects');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
}
