import { tokenValue, type SettingDef } from '@/lib/settings/types';

/**
 * The Google OAuth client that signs people in on a deployed server (docs/deploy/railway.md §3), as two
 * settings. Sign-in only: scopes openid, email and profile, never a Gmail scope — mail goes through
 * mailguard (docs/25 §12). Declared here because only this folder names Google's OAuth hosts and these
 * variables (npm run boundaries). They are new names on purpose: the removed Gmail OAuth client's
 * variables stay forbidden everywhere.
 */
export const GOOGLE_CLIENT_ID_SETTING: SettingDef = {
  key: 'google.clientId',
  label: 'Google client ID',
  group: 'signin',
  secret: false,
  env: 'GOOGLE_SIGNIN_CLIENT_ID',
  help: 'Google Cloud console → Google Auth Platform → Clients → your Web application client.',
  placeholder: '1234567890-abc.apps.googleusercontent.com',
  validate: (v) => tokenValue('google.clientId', 'The Google client ID', v, { pattern: /^[\w.-]+\.apps\.googleusercontent\.com$/, patternWhy: 'A Google client ID ends in .apps.googleusercontent.com.' }),
};

export const GOOGLE_CLIENT_SECRET_SETTING: SettingDef = {
  key: 'google.clientSecret',
  label: 'Google client secret',
  group: 'signin',
  secret: true,
  env: 'GOOGLE_SIGNIN_CLIENT_SECRET',
  help: 'Shown when the client is made, beside its ID. Removing it stops anyone signing in until a new one is entered; setup does not reopen.',
  placeholder: 'GOCSPX-…',
  validate: (v) => tokenValue('google.clientSecret', 'The Google client secret', v, { min: 10, pattern: /^[\w-]+$/, patternWhy: 'A Google client secret is letters, digits, - and _.' }),
};

/** Where the setup page sends a person in the Google Cloud console. Links only; never fetched. */
export const GOOGLE_CONSOLE = {
  newProject: 'https://console.cloud.google.com/projectcreate',
  branding: 'https://console.cloud.google.com/auth/branding',
  audience: 'https://console.cloud.google.com/auth/audience',
  clients: 'https://console.cloud.google.com/auth/clients',
} as const;
