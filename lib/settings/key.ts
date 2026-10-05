/**
 * The one secret that lives outside the app (docs/deploy/railway.md §3): PLCOS_SECRET, the key that
 * encrypts the stored secrets and signs sessions. Copied from MailGuard's rootSecret.
 *
 *   PLCOS_SECRET set        base64, at least 32 bytes. Railway keeps it as a sealed variable.
 *   deployed, unset         made once on the volume, `<data>/secret` (mode 0600, never overwritten), and
 *                           Settings recommends moving it into the variable: a copy of the volume alone
 *                           should not be able to decrypt what the database holds.
 *   the Mac (dev, demo)     a dev secret under the profile's data folder, which git ignores. Nothing is
 *                           derived from a real key.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config } from '@/config/deployment';
import { deployedServer } from '@/config/sign-in';

const g = globalThis as typeof globalThis & { __plcosRootSecret?: { key: Buffer; source: SecretSource; file: string | null } };
export type SecretSource = 'env' | 'volume' | 'dev-file';

/** The data folder the volume mounts on (/app/data in the image): config.data.root's parent. */
export const dataDir = () => resolve(/* turbopackIgnore: true */ process.cwd(), config.data.root, '..');

/** Where the key is kept when PLCOS_SECRET is unset. */
export function secretFile(): string {
  return deployedServer()
    ? join(dataDir(), 'secret')
    : resolve(/* turbopackIgnore: true */ process.cwd(), config.data.root, 'dev-secret');
}

function decode(text: string, where: string): Buffer {
  const buf = Buffer.from(text.trim(), 'base64');
  if (buf.length < 32) throw new Error(`${where} must hold at least 32 bytes, base64 (openssl rand -base64 32).`);
  return buf;
}

/**
 * Why a deployed server must not start, if it must not: PLCOS_SECRET is unset and Railway says no volume
 * holds the data folder, so a key made now would be a new one on every deploy, and every stored secret (the
 * Google client included) would stop decrypting at the next one. Null when it may start.
 */
export function bootRefusal(env: Record<string, string | undefined> = process.env): string | null {
  if (!deployedServer(env) || env.PLCOS_SECRET?.trim()) return null;
  const warning = storageWarning(env);
  return warning
    ? `[setup] Refusing to start: PLCOS_SECRET is not set, and the key would be made on a disk that is lost on every deploy. ${warning} Or set PLCOS_SECRET (openssl rand -base64 32) as a sealed variable.`
    : null;
}

/** A key file another process is writing this instant can read as empty; wait briefly before giving up. */
function readKeyFile(file: string): string {
  for (let i = 0; ; i++) {
    const text = readFileSync(/* turbopackIgnore: true */ file, 'utf8').trim();
    if (text || i >= 20) return text;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); // 20 × 25 ms
  }
}

function load(): { key: Buffer; source: SecretSource; file: string | null } {
  const fromEnv = process.env.PLCOS_SECRET?.trim();
  if (fromEnv) return { key: decode(fromEnv, 'PLCOS_SECRET'), source: 'env', file: null };
  const refusal = bootRefusal();
  if (refusal) throw new Error(refusal);
  const file = secretFile();
  if (!existsSync(/* turbopackIgnore: true */ file)) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    // wx: never overwrite a key another process wrote a moment ago.
    try { writeFileSync(/* turbopackIgnore: true */ file, randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    try { chmodSync(/* turbopackIgnore: true */ file, 0o600); } catch { /* a volume that refuses chmod still works */ }
    if (deployedServer()) console.warn(`[setup] PLCOS_SECRET is not set: made one at ${file}. Move it into the PLCOS_SECRET variable (Settings → Connections says how).`);
  }
  return { key: decode(readKeyFile(file), file), source: deployedServer() ? 'volume' : 'dev-file', file };
}

export function rootSecret(): Buffer {
  return (g.__plcosRootSecret ??= load()).key;
}

/** Where the key came from, for Settings and /setup. Never the key. */
export function secretSource(): { source: SecretSource; file: string | null } {
  const { source, file } = (g.__plcosRootSecret ??= load());
  return { source, file };
}

/** For the properties: forget the cached key, so a changed PLCOS_SECRET is read again. */
export function forgetRootSecret() { delete g.__plcosRootSecret; }

/**
 * Why the data folder won't survive a redeploy, if we can tell (MailGuard's storageWarning). Railway sets
 * RAILWAY_VOLUME_MOUNT_PATH only when a volume is attached; without one every deploy starts from an empty
 * disk, and the research files, the issues and a volume-kept key go with it.
 */
export function storageWarning(env: Record<string, string | undefined> = process.env): string | null {
  const onRailway = !!(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PROJECT_ID);
  if (!onRailway) return null;
  const dir = dataDir();
  const mount = env.RAILWAY_VOLUME_MOUNT_PATH;
  if (mount && resolve(mount) === dir) return null;
  return mount
    ? `The Railway volume is mounted at ${mount}, but this app keeps its files in ${dir}. Change the volume’s mount path to ${dir}, or they are lost on the next deploy.`
    : `No volume is attached on Railway, so the research files, the issues and anything kept on disk are lost on every deploy. Add a volume to this service with mount path ${dir}.`;
}
