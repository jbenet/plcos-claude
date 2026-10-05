import { config } from '@/config/deployment';
import { settingValue } from '@/lib/settings/store';
import { DAKOTA_PASSWORD_SETTING, DAKOTA_USERNAME_SETTING } from './setting';

/**
 * Dakota's sign-in: the environment's (scripts/with-dakota-key.sh, from the Keychain) when it has both,
 * else the one entered in Settings → Connections. Synchronous, over the settings cache. Real profile only,
 * and never in a preview copy.
 */
export function dakotaSignIn(): { username: string; password: string } | null {
  if (config.data.profile !== 'real' || config.data.copyTakenAt) return null;
  const username = settingValue(DAKOTA_USERNAME_SETTING.key), password = settingValue(DAKOTA_PASSWORD_SETTING.key);
  return username && password ? { username, password } : null;
}
