import { tokenValue, type SettingDef } from '@/lib/settings/types';

/**
 * The Linear key as a setting (docs/deploy/railway.md §3), declared beside the client: only this folder
 * names the variable (npm run boundaries). LINEAR_API_KEY in the environment still wins.
 */
export const LINEAR_SETTING: SettingDef = {
  key: 'linear.apiKey',
  label: 'Linear API key',
  group: 'connectors',
  secret: true,
  env: 'LINEAR_API_KEY',
  help: 'Linear → Settings → Security & access → Personal API keys. Read-only use: allowlisted queries, every mutation refused before sending. Used only by the real profile.',
  placeholder: 'lin_api_…',
  validate: (v) => tokenValue('linear.apiKey', 'The Linear key', v, { pattern: /^lin_api_[A-Za-z0-9]+$/, patternWhy: 'A Linear personal key starts with lin_api_.' }),
};
