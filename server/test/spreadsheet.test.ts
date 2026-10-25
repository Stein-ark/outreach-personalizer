import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { Prospect } from '@op/shared';
import { EXPORT_COLUMNS, buildProspectWorkbook, neutralizeCell } from '../src/services/spreadsheet.js';

describe('neutralizeCell', () => {
  it.each([
    ['=HYPERLINK("http://evil","x")', `'=HYPERLINK("http://evil","x")`],
    ['+1+1', `'+1+1`],
    ['-2+3', `'-2+3`],
    ['@SUM(A1)', `'@SUM(A1)`],
    ['\t=1', `'\t=1`],
    ['\r=1', `'\r=1`],
    ['\n=1', `'\n=1`],
    ['＝1+1', `'＝1+1`],
    ['＋1', `'＋1`],
    ['－1', `'－1`],
    ['＠x', `'＠x`],
    ['  =1+1', `'  =1+1`],
  ])('neutralizes %j', (input, expected) => {
    expect(neutralizeCell(input)).toBe(expected);
  });

  it.each(['Jane Doe', 'jane@x.com', '2026-10-25 10:00', '', 'a=b', 'Hi there,\n\nThanks'])('leaves %j alone', (v) => {
    expect(neutralizeCell(v)).toBe(v);
  });
});

const prospect = (over: Partial<Prospect>): Prospect => ({
  id: '1',
  email: 'jane@x.example',
  sourceUrl: 'https://a.example/team',
  sourceTitle: 'Team',
  subject: 'Hello',
  body: 'Body text',
  status: 'drafted',
  sheet: 1,
  createdAt: '2026-10-25T10:00:00.000Z',
  updatedAt: '2026-10-25T10:00:00.000Z',
  expiresAt: '2026-10-25T13:00:00.000Z',
  ...over,
});

describe('buildProspectWorkbook', () => {
  // Reading our own output back is test only. The app never parses spreadsheets.
  const wb = XLSX.read(buildProspectWorkbook([prospect({ email: '=cmd|calc@x.example', body: '+danger' }), prospect({ id: '2', email: '12345@x.example' })]), { type: 'buffer', cellStyles: true });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;

  it('writes one sheet with the required headers in order', () => {
    expect(wb.SheetNames).toEqual(['Prospects']);
    const headers = EXPORT_COLUMNS.map((_, c) => ws[XLSX.utils.encode_cell({ r: 0, c })]?.v);
    expect(headers).toEqual(['Email', 'Status', 'Date added', 'Found on', 'Source URL', 'Draft subject', 'Draft body']);
  });

  it('forces string cells and neutralizes formulas', () => {
    expect(ws.A2).toMatchObject({ t: 's', v: `'=cmd|calc@x.example` });
    expect(ws.G2).toMatchObject({ t: 's', v: `'+danger` });
    expect(ws.A3).toMatchObject({ t: 's', v: '12345@x.example' });
    expect(Object.values(ws).some((cell) => typeof cell === 'object' && cell !== null && 'f' in cell)).toBe(false);
  });

  it('makes the draft body column wide', () => {
    expect(ws['!cols']?.[6]?.wch).toBeGreaterThanOrEqual(80);
  });
});
