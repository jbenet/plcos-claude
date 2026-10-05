import { config } from '@/config/deployment';
import { settingValue } from '@/lib/settings/store';
import { ANTHROPIC_SETTING } from './setting';

/**
 * The Anthropic key: ANTHROPIC_API_KEY when the environment has it, else the one entered in Settings →
 * Connections. Synchronous, over the settings cache (lib/settings/store.ts). A preview copy never has it.
 */
export function anthropicKey(): string | null {
  if (config.data.copyTakenAt) return null;
  return settingValue(ANTHROPIC_SETTING.key) ?? null;
}
