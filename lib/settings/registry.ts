/**
 * Every setting the app manages, assembled from the folders that own them (docs/deploy/railway.md §3).
 * A key that is not here is refused on write and ignored on read. Order is the order of the page.
 */
import { AFFINITY_SETTING } from '@/lib/connectors/affinity/setting';
import { GOOGLE_CLIENT_ID_SETTING, GOOGLE_CLIENT_SECRET_SETTING } from '@/lib/connectors/google-signin/setting';
import { LINEAR_SETTING } from '@/lib/connectors/linear/setting';
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

export const SETTINGS: readonly SettingDef[] = [
  PUBLIC_URL_SETTING,
  GOOGLE_CLIENT_ID_SETTING,
  GOOGLE_CLIENT_SECRET_SETTING,
  SESSION_DAYS_SETTING,
  AFFINITY_SETTING,
  LINEAR_SETTING,
  ANTHROPIC_SETTING,
  MAILGUARD_ADDRESS_SETTING,
  FEEDBACK_EXPORT_SETTING,
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));
export const settingDef = (key: string): SettingDef | undefined => BY_KEY.get(key);
export const isSettingKey = (key: unknown): key is string => typeof key === 'string' && BY_KEY.has(key);

export const SIGN_IN_KEYS = [GOOGLE_CLIENT_ID_SETTING.key, GOOGLE_CLIENT_SECRET_SETTING.key] as const;
