import { config } from '@/config/deployment';
import { settingValue } from '@/lib/settings/store';
import { LINEAR_SETTING } from './setting';

/**
 * The Linear key, read here and nowhere else: `npm run boundaries` fails when
 * anything outside lib/connectors/linear/ names the variable or Linear's host (docs/24-linear.md).
 *
 * `npm run dev:real` puts it there from one macOS Keychain item (service `plcos-linear`, account
 * `api-key`; `npm run linear:store`) through scripts/with-linear-key.sh, and the environment wins. On a
 * deployed server it is entered in the app instead, encrypted with PLCOS_SECRET (docs/deploy/railway.md
 * §3). Nothing writes it to a file or prints it. The demo and a preview copy never see it, even when the
 * shell has it set.
 */
const VARIABLE = 'LINEAR_API_KEY';

export function linearKey(): string | null {
  if (config.data.profile !== 'real' || config.data.copyTakenAt) return null;
  return settingValue(LINEAR_SETTING.key) ?? null;
}

/** Whether a key reached this server, without handing it to the caller. */
export const linearKeyPresent = (): boolean => linearKey() !== null;

/** An environment without the key: a preview's, which the launcher starts (scripts/serve.ts). */
export function withoutLinearKey(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  delete out[VARIABLE];
  return out;
}
