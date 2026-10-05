import { SettingError, type SettingDef } from '@/lib/settings/types';
import { parseBase } from './allowlist';

/**
 * Mailguard's address as a setting (docs/deploy/railway.md §3, docs/25 §12): entered in Settings →
 * Connections. MAILGUARD_URL in the environment still wins (the Mac's scripts/with-mailguard-token.sh), and
 * config.email.mailguard.url is the fallback when neither is set. Declared here because only this folder
 * names the variable (npm run boundaries).
 *
 * Each person's mailguard key is not a server setting: it is theirs, pasted in Preferences, and kept by the
 * connector's own token store (tokens.ts).
 */
export const MAILGUARD_ADDRESS_SETTING: SettingDef = {
  key: 'mailguard.url',
  label: 'Mailguard address',
  group: 'connectors',
  secret: false,
  env: 'MAILGUARD_URL',
  help: 'The origin of the mailguard that moves drafts into each person’s own Gmail (docs/25 §12). Each person pastes their own drafts-only key in Preferences.',
  placeholder: 'https://mail.example.com',
  validate: (v) => {
    const base = parseBase(v);
    if (!(base instanceof URL)) throw new SettingError('mailguard.url', base.why);
    return base.origin;
  },
};
