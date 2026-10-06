import { SettingError, type SettingDef } from '@/lib/settings/types';

/**
 * Whether this server runs research workflows itself (docs/28-cloud-workflows.md). Off unless an Admin
 * turns it on: a cloud run sends findings and the pages they cite to the Anthropic API, so it is a decision,
 * not a default. The Anthropic key must be one from a zero-retention, no-training workspace; the app cannot
 * check that, so the person turning this on vouches for it.
 */
export const CLOUD_WORKFLOWS_SETTING: SettingDef = {
  key: 'workflows.cloud',
  label: 'Cloud workflows',
  group: 'connectors',
  secret: false,
  env: 'PLCOS_CLOUD_WORKFLOWS',
  help: 'on lets this server run research workflows itself (Developer → Enrichment: the W1c fact check, W1 profiles, and the Run W1/W1c/W5 buttons), with the Anthropic key above. Turn it on only if that key is from a zero-retention workspace with training off. off, or empty, refuses every cloud run.',
  placeholder: 'off',
  validate: (v) => {
    const t = v.trim().toLowerCase();
    if (t !== 'on' && t !== 'off') throw new SettingError('workflows.cloud', 'Type on or off.');
    return t;
  },
};
