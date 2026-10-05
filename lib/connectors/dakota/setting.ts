import { tokenValue, type SettingDef } from '@/lib/settings/types';

/**
 * Dakota's sign-in as two settings (Juan, 4 Oct 2026: Dakota moves to the cloud, "our db same way as pl's
 * warehouse"). Entered in Settings → Connections on Railway and kept encrypted with PLCOS_SECRET; on the Mac
 * scripts/with-dakota-key.sh puts DAKOTA_USERNAME / DAKOTA_PASSWORD in the environment from the Keychain,
 * and the environment wins. Declared beside the client: Dakota stays read-only, only this folder talks to
 * it, and its private fields never go to an outside service, a prompt or MCP (docs/20-dakota.md).
 */
export const DAKOTA_USERNAME_SETTING: SettingDef = {
  key: 'dakota.username',
  label: 'Dakota username',
  group: 'connectors',
  secret: false,
  env: 'DAKOTA_USERNAME',
  help: 'The Dakota Marketplace API sign-in. Read-only use: list and count only, from the Dakota workflow, one request a second. Used only by the real profile.',
  placeholder: 'Dakota API username',
  validate: (v) => tokenValue('dakota.username', 'The Dakota username', v, { min: 3, max: 200 }),
};

export const DAKOTA_PASSWORD_SETTING: SettingDef = {
  key: 'dakota.password',
  label: 'Dakota password',
  group: 'connectors',
  secret: true,
  env: 'DAKOTA_PASSWORD',
  help: 'The password for that sign-in.',
  placeholder: 'Dakota API password',
  validate: (v) => tokenValue('dakota.password', 'The Dakota password', v, { min: 6, max: 500 }),
};
