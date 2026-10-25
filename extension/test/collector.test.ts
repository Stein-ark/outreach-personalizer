import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CollectedPerson } from '@op/shared';
import { collectPeople, mayCollect } from '../src/lib/collector';
import { emailChoicesFrom, emailMatchesName } from '../src/lib/deterministic';

function loadHtml(html: string) {
  document.open();
  document.write(html);
  document.close();
}

describe('collectPeople on a team page', () => {
  let people: ReturnType<typeof collectPeople>;
  const byEmail = (e: string) => people.find((p) => p.email === e);

  beforeAll(() => {
    loadHtml(readFileSync(join(process.cwd(), 'test/fixtures/team.html'), 'utf8'));
    people = collectPeople(document);
  });

  it('finds every visible address, from mailto links and from plain text', () => {
    expect(people.map((p) => p.email).sort()).toEqual(
      [
        'ana@x.example',
        'bo@x.example',
        'dealflow@fernwood.example',
        'info@fernwood.example',
        'lena@fernwood.example',
        'maya@fernwood.example',
        'press@fernwood.example',
        'sam.reid@fernwood.example',
      ].sort(),
    );
  });

  it('pairs each address with the name on its card', () => {
    expect(byEmail('maya@fernwood.example')?.name).toBe('Maya Ortiz');
    expect(byEmail('sam.reid@fernwood.example')?.name).toBe('Sam Reid');
    expect(byEmail('lena@fernwood.example')?.name).toBe('Lena Park');
  });

  it('leaves shared inboxes unnamed', () => {
    expect(byEmail('press@fernwood.example')?.name).toBeNull();
    expect(byEmail('info@fernwood.example')?.name).toBeNull();
  });

  it('skips hidden addresses and image file names', () => {
    expect(byEmail('hidden.person@fernwood.example')).toBeUndefined();
    expect(people.some((p) => p.email.endsWith('.png'))).toBe(false);
  });

  it('names people listed on one line with their address, without borrowing a neighbour', () => {
    expect(byEmail('ana@x.example')?.name).toBe('Ana Diaz');
    expect(byEmail('bo@x.example')?.name).toBe('Bo Chen');
  });

  it('produces only data the server contract accepts', () => {
    for (const p of people) expect(CollectedPerson.safeParse(p).success).toBe(true);
  });

  it('caps a page at 50 people', () => {
    loadHtml(`<main>${Array.from({ length: 70 }, (_, i) => `<p>p${i}@many.example</p>`).join('')}</main>`);
    expect(collectPeople(document)).toHaveLength(50);
  });
});

describe('mayCollect', () => {
  const ok = { protocol: 'https:', hostname: 'fernwood.example' };

  it('runs on ordinary sites', () => {
    loadHtml('<main><p>hello</p></main>');
    expect(mayCollect(document, ok)).toBe(true);
  });

  it('never runs on pages with password, card or one time code fields', () => {
    for (const field of ['<input type="password">', '<input autocomplete="cc-number">', '<input autocomplete="one-time-code">']) {
      loadHtml(`<form>${field}</form>`);
      expect(mayCollect(document, ok)).toBe(false);
    }
  });

  it('never runs on LinkedIn, webmail, payments or private network hosts', () => {
    loadHtml('<main></main>');
    for (const hostname of ['www.linkedin.com', 'mail.google.com', 'outlook.office.com', 'www.paypal.com', 'localhost', '192.168.1.10', '10.0.0.5', 'printer.local']) {
      expect(mayCollect(document, { protocol: 'https:', hostname })).toBe(false);
    }
    expect(mayCollect(document, { protocol: 'chrome:', hostname: 'settings' })).toBe(false);
  });
});

describe('email choices for one click mode', () => {
  const base = { url: '', title: '', description: null, og: { title: null, description: null, siteName: null, type: null }, jsonLd: [], headings: [], textTruncated: false };

  it('lists every address on the page, mailto first, without duplicates or image names', () => {
    const choices = emailChoicesFrom({ ...base, mailtos: ['maya@f.example'], text: 'Write to MAYA@f.example or sam@f.example. logo@2x.png' });
    expect(choices).toEqual(['maya@f.example', 'sam@f.example']);
  });

  it('flags the address that matches the name', () => {
    expect(emailMatchesName('maya@f.example', 'Maya Ortiz')).toBe(true);
    expect(emailMatchesName('m.ortiz@f.example', 'Maya Ortiz')).toBe(true);
    expect(emailMatchesName('sam@f.example', 'Maya Ortiz')).toBe(false);
    expect(emailMatchesName('info@f.example', null)).toBe(false);
  });
});
