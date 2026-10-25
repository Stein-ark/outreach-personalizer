/**
 * Generates a key pair that gives the unpacked extension a stable id, so the server's CORS allowlist
 * (CORS_ORIGINS) can name it. Prints the public key for WXT_EXTENSION_KEY and the resulting extension id.
 * The private key is written to extension/keys/ (git ignored) and is only needed to pack a .crx yourself.
 * The Chrome Web Store assigns its own key: after the first upload, copy the store's public key instead.
 *
 * Usage: node scripts/gen-key.mjs
 */
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const out = new URL('../keys/', import.meta.url);
const privatePath = new URL('extension-private-key.pem', out);
if (existsSync(privatePath)) {
  console.error('keys/extension-private-key.pem already exists. Delete it first if you really want a new id.');
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const der = publicKey.export({ type: 'spki', format: 'der' });
// Chrome derives the id from the SHA-256 of the public key: first 32 hex digits, mapped 0-f to a-p.
const id = [...createHash('sha256').update(der).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

mkdirSync(out, { recursive: true });
writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

console.log(`WXT_EXTENSION_KEY=${der.toString('base64')}`);
console.log(`Extension id: ${id}`);
console.log(`Server CORS_ORIGINS=chrome-extension://${id}`);
