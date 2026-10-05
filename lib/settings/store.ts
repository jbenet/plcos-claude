/**
 * Settings kept in the app (docs/deploy/railway.md §3; MailGuard's integrations.ts, on Postgres).
 *
 *   - An environment value always wins, and the app refuses to change a field the environment sets: the
 *     Mac's Keychain wrappers keep working, and a sealed Railway variable cannot be overridden from a page.
 *   - Each secret is encrypted on its own (AES-256-GCM under a subkey of PLCOS_SECRET, bound to its key).
 *   - The key readers (affinityKey(), linearKey(), the Google client, anthropicKey(), the export token) are
 *     synchronous, so they read an in-process cache. It is loaded after migrations at boot (lib/db), by the
 *     import worker, refreshed after every write in this process, and re-read on a short TTL for changes
 *     made by another process.
 *   - A write checks every value first and writes nothing unless all pass; then one transaction writes the
 *     rows and one audit row per key, naming the key and never the value.
 */
import { config } from '@/config/deployment';
import type { Queryable } from '@/lib/db';
import { decrypt, encrypt } from './crypto';
import { SETTINGS, settingDef, SIGN_IN_KEYS } from './registry';
import { SettingError, type SettingDef, type SettingGroup } from './types';

type Row = { value: string; secret: boolean; updatedAt: string | null };
type Cache = { rows: Map<string, Row>; loadedAt: number; loaded: boolean; refreshing: Promise<void> | null };
const g = globalThis as typeof globalThis & { __plcosSettings?: Cache };
const cache = (): Cache => (g.__plcosSettings ??= { rows: new Map(), loadedAt: 0, loaded: false, refreshing: null });

const envValue = (def: SettingDef): string | undefined => (def.env ? process.env[def.env]?.trim() || undefined : undefined);

/** Read every row into the cache. Called at boot, after a write, and by the TTL refresh. */
export async function loadSettings(q?: Queryable): Promise<void> {
  const { readSettingRows } = await import('@/modules/platform');
  const rows = await readSettingRows(q);
  const c = cache();
  c.rows = new Map(rows.map((r) => [r.key, { value: r.value, secret: r.secret, updatedAt: r.updatedAt }]));
  c.loadedAt = Date.now();
  c.loaded = true;
}

/** For pages and routes that must not answer from an empty cache (a server's first request). */
export async function settingsReady(): Promise<void> {
  const c = cache();
  if (c.loaded && Date.now() - c.loadedAt < config.auth.settingsTtlMs) return;
  const { getDb } = await import('@/lib/db');
  await loadSettings(await getDb());
}

/** Re-read in the background when the cache is old. Uses a handle already open; never boots a database. */
function maybeRefresh(): void {
  const c = cache();
  if (c.refreshing || (c.loaded && Date.now() - c.loadedAt < config.auth.settingsTtlMs)) return;
  c.refreshing = (async () => {
    const { openedDb } = await import('@/lib/db');
    const db = openedDb();
    if (db) await loadSettings(await db);
  })().catch(() => undefined).finally(() => { cache().refreshing = null; });
}

function appValue(def: SettingDef): { value: string | undefined; unreadable: boolean } {
  const row = cache().rows.get(def.key);
  if (!row) return { value: undefined, unreadable: false };
  if (!def.secret) return { value: row.value, unreadable: false };
  // A changed PLCOS_SECRET, or a row copied from another server: unset, and the page says why.
  try { return { value: decrypt(row.value, def.key), unreadable: false }; } catch { return { value: undefined, unreadable: true }; }
}

/**
 * A setting's value: the environment's, else the app's, else undefined. Synchronous. A preview copy of the
 * real data never gets a stored secret, whatever its database holds.
 */
export function settingValue(key: string): string | undefined {
  const def = settingDef(key);
  if (!def) return undefined;
  const env = envValue(def);
  if (env) return env;
  if (def.secret && config.data.copyTakenAt) return undefined;
  maybeRefresh();
  return appValue(def).value;
}

/** Whether this process holds a stored row for the key, whether or not it decrypts. */
export const hasStoredRow = (key: string): boolean => cache().rows.has(key);

/** Stored secrets that do not decrypt with this server's PLCOS_SECRET: a changed or lost key. */
export function unreadableSettings(): string[] {
  return SETTINGS.filter((def) => def.secret && appValue(def).unreadable).map((def) => def.key);
}

export function settingSource(key: string): 'env' | 'app' | 'unset' {
  const def = settingDef(key);
  if (!def) return 'unset';
  if (envValue(def)) return 'env';
  return cache().rows.has(key) ? 'app' : 'unset';
}

/** Google sign-in can work: both halves of the client are known. */
export const googleConfigured = (): boolean => SIGN_IN_KEYS.every((k) => !!settingValue(k));

export interface SettingView {
  key: string; label: string; group: SettingGroup; secret: boolean; env: string | null; help: string; placeholder: string;
  source: 'env' | 'app' | 'unset';
  /**
   * A plain value in full; a secret as •••• and its last four when it is at least 16 characters long (a short
   * one would give too much of itself away), else as •••• alone; an env-set secret as nothing at all.
   */
  shown: string;
  /** Stored, but it does not decrypt with this server's PLCOS_SECRET. */
  unreadable: boolean;
  updatedAt: string | null;
}

/** What a page may show. No secret value leaves this function. */
export function settingsView(): SettingView[] {
  return SETTINGS.map((def) => {
    const env = envValue(def);
    const app = env ? { value: undefined, unreadable: false } : appValue(def);
    const source = env ? 'env' : cache().rows.has(def.key) ? 'app' : 'unset';
    const v = env ?? app.value;
    const shown = !v ? '' : !def.secret ? v : env ? '' : v.length >= 16 ? `••••${v.slice(-4)}` : '••••';
    return {
      key: def.key, label: def.label, group: def.group, secret: def.secret, env: def.env, help: def.help, placeholder: def.placeholder,
      source, shown, unreadable: app.unreadable, updatedAt: cache().rows.get(def.key)?.updatedAt ?? null,
    };
  });
}

export type SettingPatch = Record<string, string | null>;
export interface CheckedChange { def: SettingDef; value: string | null }

/**
 * Check a whole patch before anything is written: an unknown key, a field the environment sets, and a bad
 * value each refuse all of it. `null` removes a stored value.
 */
export function checkSettings(patch: SettingPatch): CheckedChange[] {
  // Only a server with a real sign-in keeps settings. On the Mac's user switcher anyone on the network can
  // pick an admin, so nothing may be changed from a page there: its keys come from the environment
  // (the Keychain wrappers) instead.
  if (config.auth.provider !== 'google' && config.auth.provider !== 'labos') {
    throw new SettingError('', 'Settings are changed only on a deployed server with sign-in. On the Mac, keys come from the environment (the Keychain wrappers).');
  }
  const out: CheckedChange[] = [];
  for (const [key, raw] of Object.entries(patch)) {
    const def = settingDef(key);
    if (!def) throw new SettingError(key, 'That is not a setting this app knows.');
    if (envValue(def)) throw new SettingError(key, `${def.label} is set by ${def.env} in the server’s environment. Change it there, or remove it there to manage it here.`);
    if (raw !== null && typeof raw !== 'string') throw new SettingError(key, `${def.label} must be text.`);
    out.push({ def, value: raw === null ? null : def.validate(raw) });
  }
  return out;
}

export interface Writer { actorId: string | null; via: 'setup' | 'settings' }

/**
 * Write checked changes in one transaction, with one audit row per key (the key, never the value), plus
 * whatever else the caller must write with them (/setup's first admin). Then reload the cache.
 */
export async function writeSettings(changes: CheckedChange[], who: Writer, more?: (tx: Queryable) => Promise<void>): Promise<void> {
  const { getDb } = await import('@/lib/db');
  const { appendAudit, deleteSettingRow, upsertSettingRow } = await import('@/modules/platform');
  const db = await getDb();
  await db.transaction(async (tx) => {
    for (const { def, value } of changes) {
      if (value === null) {
        const removed = await deleteSettingRow(tx, def.key);
        if (removed) await appendAudit({ actorId: who.actorId, action: 'settings.clear', subjectType: 'setting', subjectId: def.key, detail: { key: def.key, via: who.via } }, tx);
        continue;
      }
      await upsertSettingRow(tx, def.key, def.secret ? encrypt(value, def.key) : value, def.secret, who.actorId);
      await appendAudit({ actorId: who.actorId, action: 'settings.set', subjectType: 'setting', subjectId: def.key, detail: { key: def.key, via: who.via, secret: def.secret } }, tx);
    }
    if (more) await more(tx);
  });
  await loadSettings(db);
}

/** For the properties: forget the cache, as a new process would. */
export function forgetSettings() { delete g.__plcosSettings; }
