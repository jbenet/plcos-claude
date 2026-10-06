import { config } from '@/config/deployment';
import { settingValue } from '@/lib/settings/store';
import { ANTHROPIC_SETTING } from './setting';
import { CLOUD_WORKFLOWS_SETTING } from './cloud-setting';

/**
 * The Anthropic key: ANTHROPIC_API_KEY when the environment has it, else the one entered in Settings →
 * Connections. Synchronous, over the settings cache (lib/settings/store.ts). A preview copy never has it.
 */
export function anthropicKey(): string | null {
  if (config.data.copyTakenAt) return null;
  return settingValue(ANTHROPIC_SETTING.key) ?? null;
}

/** Whether this server runs workflows itself (docs/28): only when set to "on", never on a preview copy. */
export function cloudWorkflowsOn(): boolean {
  if (config.data.copyTakenAt) return false;
  return settingValue(CLOUD_WORKFLOWS_SETTING.key) === 'on';
}
