import { describe, expect, it } from 'vitest';
import { normalizeUrl } from './url.js';

describe('normalizeUrl', () => {
  it('strips tracking parameters and the fragment', () => {
    expect(normalizeUrl('https://Example.com/team/jane?utm_source=x&fbclid=abc&gclid=1#bio')).toBe(
      'https://example.com/team/jane',
    );
  });

  it('keeps meaningful parameters and sorts them', () => {
    expect(normalizeUrl('https://a.com/p?b=2&utm_medium=email&a=1')).toBe('https://a.com/p?a=1&b=2');
  });

  it('drops www, default port, credentials and a trailing slash', () => {
    expect(normalizeUrl('https://user:pw@www.a.com:443/about/')).toBe('https://a.com/about');
  });

  it('keeps the root slash', () => {
    expect(normalizeUrl('http://a.com')).toBe('http://a.com/');
  });

  it('maps visits that differ only by tracking to the same key', () => {
    expect(normalizeUrl('https://a.com/x?ref=nav')).toBe(normalizeUrl('https://a.com/x/?utm_campaign=q4'));
  });

  it('rejects non http urls and garbage', () => {
    expect(normalizeUrl('chrome://extensions')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
  });
});
