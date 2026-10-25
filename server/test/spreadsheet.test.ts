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
  name: 'Jane',
  role: 'Partner',
  company: 'Northwind',
  bio: null,
  detail: null,
  email: null,
  sourceUrl: 'https://a.example/jane',
  sourceTitle: 'Jane',
  sourceMode: 'page',
  subject: 'Hello',
  body: 'Body text',
  detailUsed: 'Led a round',
  tone: 'warm',
  length: 'short',
  goal: 'book_call',
  baseInstructionsVersion: 'v1',
  model: 'm',
  status: 'drafted',
  createdAt: '2026-10-25T10:00:00.000Z',
  updatedAt: '2026-10-25T10:00:00.000Z',
  expiresAt: '2026-10-25T13:00:00.000Z',
  ...over,
});

describe('buildProspectWorkbook', () => {
  // Reading our own output back is test only. The app never parses spreadsheets.
  const wb = XLSX.read(buildProspectWorkbook([prospect({ name: '=cmd|calc', body: '+danger' }), prospect({ id: '2', name: '12345' })]), { type: 'buffer', cellStyles: true });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;

  it('writes one sheet with the required headers in order', () => {
    expect(wb.SheetNames).toEqual(['Prospects']);
    const headers = EXPORT_COLUMNS.map((_, c) => ws[XLSX.utils.encode_cell({ r: 0, c })]?.v);
    expect(headers).toEqual(['Name', 'Role', 'Company', 'Email', 'Status', 'Date added', 'Source URL', 'Detail used', 'Draft subject', 'Draft body']);
  });

  it('forces string cells and neutralizes formulas', () => {
    expect(ws.A2).toMatchObject({ t: 's', v: `'=cmd|calc` });
    expect(ws.J2).toMatchObject({ t: 's', v: `'+danger` });
    expect(ws.A3).toMatchObject({ t: 's', v: '12345' });
    expect(Object.values(ws).some((cell) => typeof cell === 'object' && cell !== null && 'f' in cell)).toBe(false);
  });

  it('makes the draft body column wide', () => {
    expect(ws['!cols']?.[9]?.wch).toBeGreaterThanOrEqual(80);
  });
});
