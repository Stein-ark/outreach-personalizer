import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectEmailsInjected, mayCollect } from '../src/lib/collector';

function loadHtml(html: string) {
  document.open();
  document.write(html);
  document.close();
}

describe('collectEmailsInjected on a team page', () => {
  loadHtml(readFileSync(join(process.cwd(), 'test/fixtures/team.html'), 'utf8'));
  const emails = collectEmailsInjected(50);

  it('finds every visible address, from mailto links and from plain text, lowercased and without duplicates', () => {
    expect([...emails].sort()).toEqual(
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

  it('skips hidden addresses and image file names', () => {
    expect(emails).not.toContain('hidden.person@fernwood.example');
    expect(emails.some((e) => e.endsWith('.png'))).toBe(false);
  });

  it('returns only addresses, never page text', () => {
    for (const e of emails) expect(e).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
  });
});

describe('collectEmailsInjected on search results (addresses split by highlighted words)', () => {
  it('rebuilds addresses that the page splits into pieces, and never invents one from a cut off address', () => {
    loadHtml(readFileSync(join(process.cwd(), 'test/fixtures/search-results.html'), 'utf8'));
    expect(collectEmailsInjected(50)).toEqual([
      'newparadisebakery.usa@gmail.com',
      'thesaltysourdough@gmail.com',
      'martinsbakery.alison@gmail.com',
      'quinsflyrixhbakery@gmail.com',
      'bakeryyummyhouse@gmail.com',
      'almabakery@yahoo.com',
      'blackheartbakeryandgifts@gmail.com',
      'erbysbakery@gmail.com',
      'bigyummybakery@gmail.com',
    ]);
  });

  it('keeps separate blocks apart, so text from the next line never joins an address', () => {
    loadHtml('<main><p>a@x.example</p><p>clinic team</p><div>b@y.example</div><div>more</div></main>');
    expect(collectEmailsInjected(50)).toEqual(['a@x.example', 'b@y.example']);
  });
});

describe('collectEmailsInjected limits', () => {
  it('stops at the cap', () => {
    loadHtml(`<main>${Array.from({ length: 70 }, (_, i) => `<p>p${i}@many.example</p>`).join('')}</main>`);
    expect(collectEmailsInjected(50)).toHaveLength(50);
  });

  it('ignores addresses inside scripts, styles and form fields', () => {
    loadHtml('<main><script>var a="s@x.example"</script><textarea>t@x.example</textarea><p>ok@x.example</p></main>');
    expect(collectEmailsInjected(50)).toEqual(['ok@x.example']);
  });

  it('is self-contained, so Chrome can inject it into a page on its own', () => {
    // Injected functions are serialized: they must not reference anything outside their own body.
    const source = collectEmailsInjected.toString();
    expect(source).not.toMatch(/\b(import|require)\b/);
    expect(source).not.toMatch(/BLOCKED_HOSTS|NEVER_COLLECT_HOSTS|COLLECT_MAX_EMAILS/);
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
