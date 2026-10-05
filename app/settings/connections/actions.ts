'use server';
import { requireAction } from '@/lib/authz/server';
import { revalidatePath } from 'next/cache';

/**
 * Settings → Connections (docs/deploy/railway.md §3): Admin only, and a refusal is audit-logged
 * (lib/authz/server.ts). Every change is one audit row naming the key, never the value. A field the
 * environment sets cannot be changed here. No action answers with a stored secret.
 */
export type SettingResult = { ok: true; message: string } | { ok: false; error: string } | null;

export async function saveSettingAction(_prev: SettingResult, formData: FormData): Promise<SettingResult> {
  const user = await requireAction('app/settings/connections/actions.ts#saveSettingAction', _prev, formData);
  const { checkSettings, writeSettings } = await import('@/lib/settings/store');
  const { settingDef } = await import('@/lib/settings/registry');
  const { SettingError } = await import('@/lib/settings/types');
  const key = String(formData.get('key') ?? '');
  try {
    const changes = checkSettings({ [key]: String(formData.get('value') ?? '') });
    await writeSettings(changes, { actorId: user.id, via: 'settings' });
  } catch (e) {
    if (e instanceof SettingError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath('/settings/connections');
  return { ok: true, message: `${settingDef(key)?.label ?? 'Setting'} saved.` };
}

export async function clearSettingAction(formData: FormData): Promise<void> {
  const user = await requireAction('app/settings/connections/actions.ts#clearSettingAction', formData);
  const { checkSettings, writeSettings } = await import('@/lib/settings/store');
  const { SettingError } = await import('@/lib/settings/types');
  try {
    await writeSettings(checkSettings({ [String(formData.get('key') ?? '')]: null }), { actorId: user.id, via: 'settings' });
  } catch (e) {
    if (!(e instanceof SettingError)) throw e;
  }
  // Setup never reopens once completed (lib/settings/setup.ts): an admin enters a new Google client here.
  revalidatePath('/settings/connections');
}

/** Check a key where it is cheap: Anthropic's model list, Affinity's whoami. The typed value, else the saved one. */
export async function checkSettingAction(_prev: SettingResult, formData: FormData): Promise<SettingResult> {
  const user = await requireAction('app/settings/connections/actions.ts#checkSettingAction', _prev, formData);
  const { appendAudit } = await import('@/modules/platform');
  const key = String(formData.get('key') ?? '');
  let result: Exclude<SettingResult, null>;
  if (key === 'anthropic.apiKey') {
    const { anthropicKey } = await import('@/lib/workflows/key');
    const { checkAnthropicKey } = await import('@/lib/workflows/check');
    const typed = String(formData.get('value') ?? '').trim();
    const k = typed || anthropicKey();
    result = k ? await checkAnthropicKey(k) : { ok: false, error: 'No key to check.' };
  } else if (key === 'affinity.apiKey') {
    const { checkAffinityKey } = await import('@/lib/connectors/affinity');
    result = await checkAffinityKey();
  } else {
    return { ok: false, error: 'There is no check for that setting.' };
  }
  await appendAudit({ actorId: user.id, action: 'settings.check', subjectType: 'setting', subjectId: key, detail: { key, ok: result.ok } });
  return result;
}
