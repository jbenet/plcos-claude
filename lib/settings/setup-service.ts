/**
 * What /setup does with a submission (docs/deploy/railway.md §3). Two steps reach the server:
 *
 *   check   the code alone, so step 1 can say at once whether it was right. A wrong code counts.
 *   finish  the code again, and every value. All of it is checked before anything is written — a wrong
 *           code, a bad value, a missing admin each write nothing (MailGuard wrote first and could leave
 *           half a setup; this does not). Then one transaction writes the settings, the first admin and
 *           the audit rows, and the code is retired.
 *
 * Audit rows name the setting keys, never a value.
 */
import { SettingError } from './types';
import { checkSettings, googleConfigured, settingsReady, settingSource, writeSettings, type SettingPatch } from './store';
import { noteSetupFailure, setupBlocked } from './floodgate';
import { checkSetupCode, retireSetupCode, setupOpen } from './setup';
import { ANTHROPIC_SETTING } from '@/lib/workflows/setting';
import { AFFINITY_SETTING } from '@/lib/connectors/affinity/setting';
import { LINEAR_SETTING } from '@/lib/connectors/linear/setting';
import { GOOGLE_CLIENT_ID_SETTING, GOOGLE_CLIENT_SECRET_SETTING } from '@/lib/connectors/google-signin/setting';
import { PUBLIC_URL_SETTING } from './registry';

export interface SetupInput {
  mode?: unknown; code?: unknown; publicUrl?: unknown; googleClientId?: unknown; googleClientSecret?: unknown;
  adminEmail?: unknown; affinityKey?: unknown; linearKey?: unknown; anthropicKey?: unknown;
}
export type SetupAnswer =
  | { ok: true; done: boolean; message: string }
  | { ok: false; status: 400 | 403 | 409 | 429; field: string | null; error: string };

/** Which form field holds which setting. */
export const SETUP_FIELDS = {
  publicUrl: PUBLIC_URL_SETTING, googleClientId: GOOGLE_CLIENT_ID_SETTING, googleClientSecret: GOOGLE_CLIENT_SECRET_SETTING,
  affinityKey: AFFINITY_SETTING, linearKey: LINEAR_SETTING, anthropicKey: ANTHROPIC_SETTING,
} as const;
const OPTIONAL = new Set(['affinityKey', 'linearKey', 'anthropicKey']);

const EMAIL = /^[^\s@<>()",;:\\[\]]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export async function runSetup(input: SetupInput, from: { ip: string | null }): Promise<SetupAnswer> {
  const { appendAudit, activeUsersByEmail } = await import('@/modules/platform');
  await settingsReady();
  if (!setupOpen()) return { ok: false, status: 409, field: null, error: 'This server is already set up. Sign in with Google; admins change settings in Settings → Connections.' };
  if (setupBlocked(from.ip)) return { ok: false, status: 429, field: 'code', error: 'Too many wrong codes from here this hour. Wait, or restart the service for a new code (it prints in the Deploy Logs).' };
  if (!checkSetupCode(input.code)) {
    noteSetupFailure(from.ip);
    await appendAudit({ actorId: null, action: 'setup.refused', subjectType: 'setup', subjectId: null, detail: { rule: 'setup-code', ...(from.ip ? { ip: from.ip } : {}) } });
    return { ok: false, status: 403, field: 'code', error: 'That is not the code in the server log. Look for “Not set up yet” in the Deploy Logs.' };
  }
  if (input.mode === 'check') return { ok: true, done: false, message: 'The code is right.' };
  if (input.mode !== 'finish') return { ok: false, status: 400, field: null, error: 'Unknown step.' };

  // Every value, checked before anything is written.
  const patch: SettingPatch = {};
  try {
    for (const [field, def] of Object.entries(SETUP_FIELDS)) {
      const raw = typeof input[field as keyof SetupInput] === 'string' ? (input[field as keyof SetupInput] as string).trim() : '';
      if (settingSource(def.key) === 'env') continue; // set in the environment: the page says so and sends nothing
      if (!raw) {
        if (OPTIONAL.has(field) || field === 'publicUrl') continue;
        throw new SettingError(def.key, `${def.label} is needed to sign in.`);
      }
      patch[def.key] = raw;
    }
    const changes = checkSettings(patch);
    const email = typeof input.adminEmail === 'string' ? input.adminEmail.trim().toLowerCase() : '';
    if (!EMAIL.test(email) || email.length > 254) return { ok: false, status: 400, field: 'adminEmail', error: 'Enter the first admin’s Google Workspace address, like you@example.org.' };
    if ((await activeUsersByEmail(email)).length > 1) return { ok: false, status: 400, field: 'adminEmail', error: 'More than one active person already has that address. Use another, or make it unique first.' };
    // With these values, Google sign-in would be configured; otherwise nobody could sign in afterwards.
    const willHave = (key: string) => settingSource(key) === 'env' || !!patch[key];
    if (!willHave(GOOGLE_CLIENT_ID_SETTING.key) || !willHave(GOOGLE_CLIENT_SECRET_SETTING.key)) {
      return { ok: false, status: 400, field: 'googleClientId', error: 'Google sign-in needs both the client ID and the secret.' };
    }

    let adminId = '';
    await writeSettings(changes, { actorId: null, via: 'setup' }, async (tx) => {
      const { ensureAdmin } = await import('@/modules/platform');
      const { user, created } = await ensureAdmin(tx, email);
      adminId = user.id;
      await appendAudit({ actorId: null, action: 'setup.complete', subjectType: 'app_user', subjectId: user.id,
        detail: { keys: changes.map((c) => c.def.key), adminCreated: created, ...(from.ip ? { ip: from.ip } : {}) } }, tx);
    });
    retireSetupCode();
    return { ok: true, done: googleConfigured() && !!adminId, message: 'Set up. Sign in with Google as the admin you named.' };
  } catch (e) {
    if (e instanceof SettingError) {
      const field = Object.entries(SETUP_FIELDS).find(([, d]) => d.key === e.key)?.[0] ?? null;
      return { ok: false, status: 400, field, error: e.message };
    }
    throw e;
  }
}
