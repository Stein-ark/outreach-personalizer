import { describe, expect, it } from 'vitest';
import { classifyUrl } from '../src/lib/reader';
import { findLoopbackPermissions, scanText } from '../build-checks';

describe('classifyUrl', () => {
  it.each([
    ['https://fernwood.example/team/maya', 'ok'],
    ['http://example.com', 'ok'],
    ['https://www.linkedin.com/in/someone', 'blocked'],
    ['https://linkedin.com/company/x', 'blocked'],
    ['https://uk.linkedin.com/in/x', 'blocked'],
    ['https://notlinkedin.com/x', 'ok'],
    ['chrome://extensions', 'restricted'],
    ['chrome-extension://abc/page.html', 'restricted'],
    ['https://chromewebstore.google.com/detail/x', 'restricted'],
    ['https://example.com/deck.pdf', 'restricted'],
    ['file:///home/me/a.html', 'restricted'],
    ['about:blank', 'restricted'],
    [undefined, 'restricted'],
  ])('%s is %s', (url, expected) => {
    expect(classifyUrl(url)).toBe(expected);
  });
});

describe('build checks', () => {
  it('flags loopback permissions', () => {
    expect(findLoopbackPermissions({ host_permissions: ['http://localhost:8787/*'] })).toHaveLength(1);
    expect(findLoopbackPermissions({ host_permissions: ['http://127.0.0.1:8787/*'] })).toHaveLength(1);
    expect(findLoopbackPermissions({ host_permissions: ['https://api.example.com/*'] })).toHaveLength(0);
    expect(findLoopbackPermissions({ host_permissions: ['https://localhost-proxy.example.com/*'] })).toHaveLength(0);
  });

  it('detects secret patterns', () => {
    expect(scanText(`const k = "gsk_${'a'.repeat(40)}"`)).toEqual(['Groq API key']);
    expect(scanText('mongodb+srv://user:pass@cluster.mongodb.net/db')).toContain('MongoDB connection string with credentials');
    expect(scanText('const api = "https://api.example.com"')).toEqual([]);
  });
});
