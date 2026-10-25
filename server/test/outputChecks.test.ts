import { describe, expect, it } from 'vitest';
import { EMPTY_FIELDS, type ExtractRequest } from '@op/shared';
import { findOutputProblem } from '../src/services/draft.js';
import { verifyAgainstSource } from '../src/services/extract.js';

const sender = { name: 'Ada', role: null, organisation: 'Gridline', offer: 'Seed round', link: 'https://gridline.example/deck' };
const draft = (body: string, subject = 'Your VoltCo round') => ({ subject, body, detailUsed: 'x' });

describe('findOutputProblem', () => {
  it('accepts a clean draft and the sender link', () => {
    expect(findOutputProblem(draft('Hi Jane,\n\nDeck: https://gridline.example/deck.\n\nAda'), sender)).toBeNull();
    expect(findOutputProblem(draft('See www.gridline.example/deck'), sender)).toBeNull();
  });

  it('rejects any other URL', () => {
    expect(findOutputProblem(draft('Click https://evil.example/x'), sender)).toBe('unexpected URL');
    expect(findOutputProblem(draft('see https://gridline.example/deck'), { ...sender, link: null })).toBe('unexpected URL');
  });

  it('rejects email addresses and placeholders', () => {
    expect(findOutputProblem(draft('Write to me at ada@gridline.example'), sender)).toBe('email address in draft');
    expect(findOutputProblem(draft('Hi [First Name],'), sender)).toBe('placeholder left in draft');
  });
});

describe('verifyAgainstSource', () => {
  const req: ExtractRequest = {
    mode: 'page',
    url: 'https://a.example',
    title: 'Jane Doe | Northwind Ventures',
    text: 'Jane leads seed investments. Contact jane@northwind.example for pitches.',
    hints: EMPTY_FIELDS,
    mailtos: ['press@northwind.example'],
  };

  it('keeps values present in the source', () => {
    const out = verifyAgainstSource({ ...EMPTY_FIELDS, name: 'Jane Doe', company: 'Northwind Ventures', email: 'jane@northwind.example' }, req);
    expect(out).toMatchObject({ name: 'Jane Doe', company: 'Northwind Ventures', email: 'jane@northwind.example' });
  });

  it('accepts an email that appears only as a mailto link', () => {
    expect(verifyAgainstSource({ ...EMPTY_FIELDS, email: 'press@northwind.example' }, req).email).toBe('press@northwind.example');
  });

  it('drops a guessed email, name or company', () => {
    const out = verifyAgainstSource({ ...EMPTY_FIELDS, name: 'John Smith', company: 'Acme', email: 'jane.doe@northwind.example' }, req);
    expect(out).toMatchObject({ name: null, company: null, email: null });
  });
});
