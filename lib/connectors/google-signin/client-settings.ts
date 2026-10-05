import { config } from '@/config/deployment';
import { settingValue } from '@/lib/settings/store';
import { GOOGLE_CLIENT_ID_SETTING, GOOGLE_CLIENT_SECRET_SETTING } from './setting';

/**
 * The sign-in client: GOOGLE_SIGNIN_CLIENT_ID / _SECRET when the environment has them, else the ones
 * entered in /setup or Settings → Connections. Synchronous, over the settings cache. A preview copy never
 * holds the client.
 */
export function googleClientId(): string | null {
  if (config.data.copyTakenAt) return null;
  return settingValue(GOOGLE_CLIENT_ID_SETTING.key) ?? null;
}

export function googleClientSecret(): string | null {
  if (config.data.copyTakenAt) return null;
  return settingValue(GOOGLE_CLIENT_SECRET_SETTING.key) ?? null;
}
