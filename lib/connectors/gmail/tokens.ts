import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Where each person's Gmail refresh token lives (docs/25 §Per-user OAuth). Only the refresh token
 * is kept; access tokens live in memory for their hour. A token is keyed by the person's handle.
 *
 *   keychain  the live Mac: one login-Keychain item per person, service "plcos-gmail". Written
 *             through `security -i` on standard input, so the token is never on a command line.
 *   file      the demo's fake Google only: invented tokens in a 0600 file next to its database.
 *   memory    the properties.
 *
 * The deployed service will keep tokens in its database, encrypted with a key from the service's
 * secret store (docs/deploy); not built.
 */

export interface StoredGrant {
  refreshToken: string;
  email: string;
  scopes: string[];
  connectedAt: string;
}

export interface TokenStore {
  readonly kind: 'keychain' | 'file' | 'memory';
  get(handle: string): Promise<StoredGrant | null>;
  put(handle: string, grant: StoredGrant): Promise<void>;
  delete(handle: string): Promise<void>;
}

const HANDLE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const checkHandle = (h: string) => { if (!HANDLE.test(h)) throw new Error('Not a user handle.'); };

export function memoryStore(): TokenStore {
  const m = new Map<string, StoredGrant>();
  return {
    kind: 'memory',
    async get(h) { return m.get(h) ?? null; },
    async put(h, g) { checkHandle(h); m.set(h, { ...g }); },
    async delete(h) { m.delete(h); },
  };
}

export function fileStore(path: string): TokenStore {
  const read = async (): Promise<Record<string, StoredGrant>> => {
    try { return JSON.parse(await readFile(path, 'utf8')) as Record<string, StoredGrant>; } catch { return {}; }
  };
  const write = async (all: Record<string, StoredGrant>) => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(`${path}.tmp`, JSON.stringify(all, null, 2), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  };
  return {
    kind: 'file',
    async get(h) { return (await read())[h] ?? null; },
    async put(h, g) { checkHandle(h); const all = await read(); all[h] = g; await write(all); },
    async delete(h) { const all = await read(); delete all[h]; await write(all); },
  };
}

const SERVICE = 'plcos-gmail';
/** What a Google refresh token is made of; anything else is refused rather than quoted into a command. */
const TOKEN = /^[A-Za-z0-9._\/~+-]{10,2048}$/;

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
 * The login Keychain. The item's secret is the refresh token; its comment holds the address,
 * scopes and date, which are not secret. Items are created by `security`, so the server can read
 * them back without asking each time; anyone who can run commands as Juan can too, which is
 * already true of the database next to them.
 */
export function keychainStore(): TokenStore {
  return {
    kind: 'keychain',
    async get(h) {
      checkHandle(h);
      const secret = await security(['find-generic-password', '-s', SERVICE, '-a', h, '-w']);
      if (secret.code !== 0) return null;
      const attrs = await security(['find-generic-password', '-s', SERVICE, '-a', h]);
      // The comment is "address|scope scope|date": none of the three can hold a bar or a quote.
      const [email = '', scopes = '', connectedAt = ''] = (/"icmt"<blob>="(.*)"/.exec(attrs.out)?.[1] ?? '').split('|');
      return { refreshToken: secret.out.trim(), email, scopes: scopes.split(' ').filter(Boolean), connectedAt };
    },
    async put(h, g) {
      checkHandle(h);
      if (!TOKEN.test(g.refreshToken)) throw new Error('The refresh token has characters it should not; nothing was stored.');
      const clean = (x: string) => x.replace(/[|"\\\r\n]/g, '');
      const meta = [clean(g.email), clean(g.scopes.join(' ')), clean(g.connectedAt)].join('|');
      // -U replaces an older item. The command is read from standard input, never argv.
      const cmd = `add-generic-password -U -s ${SERVICE} -a ${h} -l "PLC Raise Tools — Gmail drafts (${h})" -j "${meta}" -w "${g.refreshToken}"\n`;
      const r = await security(['-i'], cmd);
      if (r.code !== 0) throw new Error('The Keychain refused the token.');
    },
    async delete(h) {
      checkHandle(h);
      await security(['delete-generic-password', '-s', SERVICE, '-a', h]);
    },
  };
}
