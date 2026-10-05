/**
 * Encryption and signatures under PLCOS_SECRET (lib/settings/key.ts), copied from MailGuard's crypto.ts.
 * Each purpose gets its own subkey through HKDF-SHA256, so a signature made for one purpose (the OAuth
 * state) is never a valid one for another (a session), and the encryption key signs nothing.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { rootSecret } from './key';

export type Purpose = 'settings' | 'session' | 'oauth' | 'person-secret' | 'warm';

const subkeys = new Map<string, { root: Buffer; key: Buffer }>();
function subkey(purpose: Purpose): Buffer {
  const root = rootSecret();
  const hit = subkeys.get(purpose);
  if (hit && hit.root === root) return hit.key;
  const key = Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), `capitalos:${purpose}`, 32));
  subkeys.set(purpose, { root, key });
  return key;
}

/**
 * AES-256-GCM, a fresh 12-byte IV each time. Output: base64(iv | tag | ciphertext). `bound` is
 * authenticated with it (the setting's key), so a value moved to another row does not decrypt.
 */
export function encrypt(plain: string, bound: string, purpose: 'settings' | 'person-secret' = 'settings'): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', subkey(purpose), iv);
  cipher.setAAD(Buffer.from(bound, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

/** Throws when the key changed, the value was moved, or a byte was altered. */
export function decrypt(sealed: string, bound: string, purpose: 'settings' | 'person-secret' = 'settings'): string {
  const buf = Buffer.from(sealed, 'base64');
  if (buf.length < 29) throw new Error('Sealed value is too short.');
  const decipher = createDecipheriv('aes-256-gcm', subkey(purpose), buf.subarray(0, 12));
  decipher.setAAD(Buffer.from(bound, 'utf8'));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export function sign(value: string, purpose: Purpose): string {
  return createHmac('sha256', subkey(purpose)).update(value).digest('base64url');
}

/** Timing-safe: the comparison takes as long for a near miss as for a stranger. */
export function verifySignature(value: string, signature: string, purpose: Purpose): boolean {
  const a = Buffer.from(sign(value, purpose));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Two strings, compared in constant time for their length (the setup code). */
export function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
