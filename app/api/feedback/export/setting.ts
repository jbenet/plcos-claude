import { tokenValue, type SettingDef } from '@/lib/settings/types';

/**
 * The feedback export token (GET /api/feedback/export, which the Mac dev session pulls new issues from).
 * Entered in Settings → Connections; FEEDBACK_EXPORT_TOKEN in the environment still wins. Unset, the
 * route answers 404.
 */
export const FEEDBACK_EXPORT_SETTING: SettingDef = {
  key: 'feedback.exportToken',
  label: 'Feedback export token',
  group: 'tokens',
  secret: true,
  env: 'FEEDBACK_EXPORT_TOKEN',
  help: 'A random token (openssl rand -hex 32), also kept on the Mac with npm run secret:store. The Mac uses it to pull new issues from this server.',
  placeholder: '64 hex characters',
  validate: (v) => tokenValue('feedback.exportToken', 'The export token', v, { min: 32, max: 200, pattern: /^[A-Za-z0-9_-]+$/, patternWhy: 'Use letters, digits, - and _ only (openssl rand -hex 32).' }),
};
