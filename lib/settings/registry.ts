/**
 * Every setting the app manages, assembled from the folders that own them (docs/deploy/railway.md §3).
 * A key that is not here is refused on write and ignored on read. Order is the order of the page.
 */
import { AFFINITY_SETTING } from '@/lib/connectors/affinity/setting';
import { GOOGLE_CLIENT_ID_SETTING, GOOGLE_CLIENT_SECRET_SETTING } from '@/lib/connectors/google-signin/setting';
import { LINEAR_SETTING } from '@/lib/connectors/linear/setting';
import { DAKOTA_PASSWORD_SETTING, DAKOTA_USERNAME_SETTING } from '@/lib/connectors/dakota/setting';
import { MAILGUARD_ADDRESS_SETTING } from '@/lib/connectors/mailguard/setting';
import { ANTHROPIC_SETTING } from '@/lib/workflows/setting';
import { FEEDBACK_EXPORT_SETTING } from '@/app/api/feedback/export/setting';
import { publicUrlValue, SettingError, type SettingDef } from './types';

export const PUBLIC_URL_SETTING: SettingDef = {
  key: 'app.publicUrl',
  label: 'Public address',
  group: 'address',
  secret: false,
  env: 'PLCOS_PUBLIC_URL',
  help: 'Where people reach this app. Google sends them back here after signing in, so it must match the redirect URI on the Google client exactly.',
  placeholder: 'https://raise.example.org',
  validate: (v) => publicUrlValue('app.publicUrl', 'The public address', v),
};

export const SESSION_DAYS_SETTING: SettingDef = {
  key: 'session.days',
  label: 'Sign-in lasts (days)',
  group: 'session',
  secret: false,
  env: null,
  help: 'How long a Google sign-in lasts before Google is asked again. A change applies to the next sign-in; Sign out everywhere ends the current ones.',
  placeholder: '30',
  validate: (v) => {
    const t = v.trim();
    if (!/^\d{1,2}$/.test(t) || Number(t) < 1 || Number(t) > 90) throw new SettingError('session.days', 'A sign-in lasts 1 to 90 days.');
    return String(Number(t));
  },
};

export const PROXY_HOPS_SETTING: SettingDef = {
  key: 'network.proxyHops',
  label: 'Trusted proxy hops',
  group: 'address',
  secret: false,
  env: 'PLCOS_TRUSTED_PROXY_HOPS',
  help: 'How many proxies in front of this server add to X-Forwarded-For; the client address is the one the outermost of them added. Railway’s edge is one (a guess until the rehearsal confirms it). The setup-code limits count by this address.',
  placeholder: '1',
  validate: (v) => {
    const t = v.trim();
    if (!/^[0-5]$/.test(t)) throw new SettingError('network.proxyHops', 'Between 0 and 5 hops.');
    return t;
  },
};

/** Workspace domains whose people may sign in with an address at another of their domains (an alias). */
export const SIGNIN_DOMAINS_SETTING: SettingDef = {
  key: 'signin.extraDomains',
  label: 'Also allowed email domains',
  group: 'signin',
  secret: false,
  env: 'PLCOS_SIGNIN_DOMAINS',
  help: 'Normally a sign-in’s address must be at the Workspace’s own domain (Google’s hd). List other domains here, separated by commas, only if your Workspace owns them as aliases. Empty is right for most.',
  placeholder: 'example.org, example.com',
  validate: (v) => {
    const list = v.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
    if (!list.length || list.length > 20) throw new SettingError('signin.extraDomains', 'One to twenty domains, separated by commas.');
    for (const d of list) if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) throw new SettingError('signin.extraDomains', `${d} is not a domain.`);
    return [...new Set(list)].join(', ');
  },
};

export const SETTINGS: readonly SettingDef[] = [
  PUBLIC_URL_SETTING,
  GOOGLE_CLIENT_ID_SETTING,
  GOOGLE_CLIENT_SECRET_SETTING,
  SIGNIN_DOMAINS_SETTING,
  SESSION_DAYS_SETTING,
  PROXY_HOPS_SETTING,
  AFFINITY_SETTING,
  LINEAR_SETTING,
  DAKOTA_USERNAME_SETTING,
  DAKOTA_PASSWORD_SETTING,
  ANTHROPIC_SETTING,
  MAILGUARD_ADDRESS_SETTING,
  FEEDBACK_EXPORT_SETTING,
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));
export const settingDef = (key: string): SettingDef | undefined => BY_KEY.get(key);
export const isSettingKey = (key: unknown): key is string => typeof key === 'string' && BY_KEY.has(key);

export const SIGN_IN_KEYS = [GOOGLE_CLIENT_ID_SETTING.key, GOOGLE_CLIENT_SECRET_SETTING.key] as const;
