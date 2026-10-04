import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { KEY_FORMAT } from './allowlist';

/**
 * Where each person's mailguard key lives (docs/25 §12.2). Keys are per person: one key, one mailbox.
 *
 *   keychain  the live Mac: one login-Keychain item per person, service "plcos-mailguard", account =
 *             their handle, for a key pasted in Preferences. Written through `security -i` on standard
 *             input, so the key is never on a command line.
 *   file      the demo's fake mailguard only: invented keys in a 0600 file next to its database.
 *   memory    the properties.
 *
 * Juan's key, stored with `npm run secret:store -- mailguard-token`, is not read here: it reaches the
 * live server's environment through scripts/with-mailguard-token.sh (index.ts reads it).
 */

export interface TokenStore {
  readonly kind: 'keychain' | 'file' | 'memory';
  get(handle: string): Promise<string | null>;
  put(handle: string, key: string): Promise<void>;
  delete(handle: string): Promise<void>;
}

const HANDLE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const checkHandle = (h: string) => { if (!HANDLE.test(h)) throw new Error('Not a user handle.'); };
const checkKey = (k: string) => { if (!KEY_FORMAT.test(k)) throw new Error('That is not a mailguard token; nothing was stored.'); };

export function memoryStore(): TokenStore {
  const m = new Map<string, string>();
  return {
    kind: 'memory',
    async get(h) { return m.get(h) ?? null; },
    async put(h, k) { checkHandle(h); checkKey(k); m.set(h, k); },
    async delete(h) { m.delete(h); },
  };
}

export function fileStore(path: string): TokenStore {
  const read = async (): Promise<Record<string, string>> => {
    try { return JSON.parse(await readFile(path, 'utf8')) as Record<string, string>; } catch { return {}; }
  };
  const write = async (all: Record<string, string>) => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(`${path}.tmp`, JSON.stringify(all, null, 2), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  };
  return {
    kind: 'file',
    async get(h) { return (await read())[h] ?? null; },
    async put(h, k) { checkHandle(h); checkKey(k); const all = await read(); all[h] = k; await write(all); },
    async delete(h) { const all = await read(); delete all[h]; await write(all); },
  };
}

const SERVICE = 'plcos-mailguard';

function security(args: string[], stdin?: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code: code ?? 1, out }));
    p.stdin.end(stdin ?? '');
  });
}

/**
 * The login Keychain. Items are created by `security`, so the server reads them back without asking
 * each time; anyone who can run commands as Juan can too, which is already true of the database.
 */
export function keychainStore(): TokenStore {
  return {
    kind: 'keychain',
    async get(h) {
      checkHandle(h);
      const r = await security(['find-generic-password', '-s', SERVICE, '-a', h, '-w']);
      const key = r.out.trim();
      return r.code === 0 && KEY_FORMAT.test(key) ? key : null;
    },
    async put(h, k) {
      checkHandle(h);
      checkKey(k);
      // -U replaces an older item. The command is read from standard input, never argv; the key's format
      // (letters, digits, underscores) leaves nothing to quote.
      const r = await security(['-i'], `add-generic-password -U -s ${SERVICE} -a ${h} -l "PLC Raise Tools — mailguard (${h})" -w "${k}"\n`);
      if (r.code !== 0) throw new Error('The Keychain refused the token.');
    },
    async delete(h) {
      checkHandle(h);
      await security(['delete-generic-password', '-s', SERVICE, '-a', h]);
    },
  };
}
