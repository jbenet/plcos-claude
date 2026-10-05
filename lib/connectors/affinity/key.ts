import { config } from '@/config/deployment';
import { settingValue } from '@/lib/settings/store';
import { AFFINITY_SETTING } from './setting';

/**
 * The Affinity key — the boundary check fails the build if anything outside this folder names its
 * variable.
 *
 * On the Mac, `npm run dev:real` puts AFFINITY_API_KEY in the environment from one macOS Keychain item
 * (scripts/with-affinity-key.sh), which asks before every read, and the environment wins. On a deployed
 * server it is entered in the app (/setup or Settings → Connections) and kept encrypted with PLCOS_SECRET
 * (docs/deploy/railway.md §3). Synchronous, over the settings cache. Neither the demo profile nor a
 * preview — a copy of the real data (docs/COLLAB.md) — ever sees it, even when the shell has it set.
 */
export function affinityKey(): string | null {
  if (config.data.profile !== 'real' || config.data.copyTakenAt) return null;
  return settingValue(AFFINITY_SETTING.key) ?? null;
}

/** An environment without the key: a preview's, which the launcher starts (scripts/serve.ts). */
export function withoutKey(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  delete out.AFFINITY_API_KEY;
  return out;
}
