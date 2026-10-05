import { tokenValue, type SettingDef } from '@/lib/settings/types';

/**
 * The Anthropic key, for the research workflows (W1, W1c, W5) and the Agent seam. Entered in /setup or
 * Settings → Connections; ANTHROPIC_API_KEY in the environment still wins. A preview copy never has it.
 */
export const ANTHROPIC_SETTING: SettingDef = {
  key: 'anthropic.apiKey',
  label: 'Anthropic API key',
  group: 'connectors',
  secret: true,
  env: 'ANTHROPIC_API_KEY',
  help: 'console.anthropic.com → API keys, from a workspace with a monthly spend limit. Turns on the W1, W1c and W5 buttons; without it they refuse and nothing else changes.',
  placeholder: 'sk-ant-…',
  validate: (v) => tokenValue('anthropic.apiKey', 'The Anthropic key', v, { pattern: /^sk-ant-[\w-]+$/, patternWhy: 'An Anthropic key starts with sk-ant-.' }),
};
