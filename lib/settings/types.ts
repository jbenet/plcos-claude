/**
 * One setting an admin manages in the app (docs/deploy/railway.md §3). Each connector declares its own
 * beside its code, so only its folder names its key's variable (npm run boundaries); lib/settings/registry.ts
 * assembles them. Nothing here reads a value.
 */
export type SettingGroup = 'address' | 'signin' | 'connectors' | 'tokens' | 'session';

export interface SettingDef {
  /** Stable key in platform.setting: lowercase words joined by dots. */
  key: string;
  label: string;
  group: SettingGroup;
  /** Encrypted at rest, never sent back to a browser: the page shows •••• and the last four. */
  secret: boolean;
  /** The environment variable that overrides it. An env value wins and the app refuses to change it. */
  env: string | null;
  /** One or two sentences for the page: where the value comes from and what it turns on. */
  help: string;
  placeholder: string;
  /** Checks and normalizes a typed value; throws a SettingError with words for the person. */
  validate(value: string): string;
}

export class SettingError extends Error {
  constructor(readonly key: string, message: string) {
    super(message);
    this.name = 'SettingError';
  }
}

/** A single token-like value: no spaces, no control characters (no CRLF into a header), a sane length. */
export function tokenValue(key: string, label: string, value: string, opts: { pattern?: RegExp; patternWhy?: string; min?: number; max?: number } = {}): string {
  const v = value.trim();
  if (!v) throw new SettingError(key, `${label} is empty.`);
  if (/[\s\x00-\x1f\x7f]/.test(v)) throw new SettingError(key, `${label} has spaces or control characters.`);
  if (v.length > (opts.max ?? 500)) throw new SettingError(key, `${label} is too long.`);
  if (v.length < (opts.min ?? 8)) throw new SettingError(key, `${label} is too short.`);
  if (opts.pattern && !opts.pattern.test(v)) throw new SettingError(key, opts.patternWhy ?? `${label} does not look right.`);
  return v;
}

/** A public https (or, on a laptop, http) origin: no credentials, query, fragment or path. */
export function publicUrlValue(key: string, label: string, value: string): string {
  const v = value.trim();
  if (!v) throw new SettingError(key, `${label} is empty.`);
  if (/[\s\x00-\x1f\x7f]/.test(v)) throw new SettingError(key, `${label} has spaces or control characters.`);
  let u: URL;
  try { u = new URL(v); } catch { throw new SettingError(key, `${label} must be a full address, like https://raise.example.org`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new SettingError(key, `${label} must start with https://`);
  if (u.username || u.password) throw new SettingError(key, `${label} cannot carry a user name or password.`);
  if (u.search || u.hash) throw new SettingError(key, `${label} cannot have a query or a fragment.`);
  if (u.pathname !== '/' && u.pathname !== '') throw new SettingError(key, `${label} is the address of the site itself, with no path.`);
  if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw new SettingError(key, `${label} must use https:// (Google allows http only for localhost).`);
  return u.origin;
}
