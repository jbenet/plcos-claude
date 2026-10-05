import { tokenValue, type SettingDef } from '@/lib/settings/types';

/**
 * The Affinity key as a setting (docs/deploy/railway.md §3): entered in /setup or Settings → Connections,
 * encrypted with PLCOS_SECRET. Declared here, beside the client, because only this folder names the
 * variable (npm run boundaries). On the Mac, AFFINITY_API_KEY from the Keychain wrapper still wins.
 */
export const AFFINITY_SETTING: SettingDef = {
  key: 'affinity.apiKey',
  label: 'Affinity API key',
  group: 'connectors',
  secret: true,
  env: 'AFFINITY_API_KEY',
  help: 'Affinity → Settings → API → Generate. Read-only use: the client sends GET requests on an allowlist and nothing else. Used only by the real profile.',
  placeholder: 'Affinity API key',
  validate: (v) => tokenValue('affinity.apiKey', 'The Affinity key', v, { min: 16 }),
};
