/**
 * Build time safety checks, wired into WXT hooks in wxt.config.ts.
 * 1. A production manifest must not grant any localhost or loopback permission.
 * 2. The built extension must not contain anything that looks like a secret.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const LOOPBACK = /(^|[/.:@])(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])([:/]|$)/i;

export function findLoopbackPermissions(manifest: { host_permissions?: string[]; permissions?: string[]; content_security_policy?: unknown }): string[] {
  const entries = [...(manifest.host_permissions ?? []), ...(manifest.permissions ?? []), JSON.stringify(manifest.content_security_policy ?? '')];
  return entries.filter((e) => LOOPBACK.test(e));
}

export const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'Groq API key', re: /gsk_[A-Za-z0-9]{20,}/ },
  { name: 'OpenAI API key', re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'MongoDB connection string with credentials', re: /mongodb(?:\+srv)?:\/\/[^\s"'/:]+:[^\s"'@]+@/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'JWT secret assignment', re: /JWT_SECRET\s*[:=]\s*["'][^"']{8,}/ },
  { name: 'AI key assignment', re: /AI_API_KEY\s*[:=]\s*["'][^"']{8,}/ },
];

export function scanText(text: string): string[] {
  return SECRET_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

/** Scans every text file under dir. Returns "file: pattern" findings. */
export function scanDirForSecrets(dir: string): string[] {
  const findings: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(js|mjs|html|css|json|map|txt)$/i.test(name)) {
        for (const hit of scanText(readFileSync(path, 'utf8'))) findings.push(`${relative(dir, path)}: ${hit}`);
      }
    }
  };
  walk(dir);
  return findings;
}
