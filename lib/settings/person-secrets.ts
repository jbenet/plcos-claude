/**
 * A secret that belongs to one person (their mailguard key), kept in platform.person_secret. AES-256-GCM
 * under the `person-secret` subkey of PLCOS_SECRET, bound to `<user id>:<purpose>`: a row copied to
 * someone else, or read for another purpose, does not decrypt. Read and written only for the person acting
 * (the callers pass their own user); never shown back except masked (maskSecret).
 */
import { decrypt, encrypt } from './crypto';

const bound = (userId: string, purpose: string) => `${userId}:${purpose}`;

export async function personSecret(userId: string, purpose: string): Promise<string | null> {
  const { readPersonSecret } = await import('@/modules/platform');
  const sealed = await readPersonSecret(userId, purpose);
  if (!sealed) return null;
  try { return decrypt(sealed, bound(userId, purpose), 'person-secret'); } catch { return null; }
}

export async function setPersonSecret(userId: string, purpose: string, value: string): Promise<void> {
  const { writePersonSecret } = await import('@/modules/platform');
  await writePersonSecret(userId, purpose, encrypt(value, bound(userId, purpose), 'person-secret'));
}

export async function clearPersonSecret(userId: string, purpose: string): Promise<boolean> {
  const { deletePersonSecret } = await import('@/modules/platform');
  return deletePersonSecret(userId, purpose);
}
