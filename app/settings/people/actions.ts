'use server';
import { requireAction } from '@/lib/authz/server';
import { revalidatePath } from 'next/cache';

/**
 * Settings → People (docs/deploy/railway.md §3): who Google sign-in admits. Admin only, and a refusal is
 * audit-logged (lib/authz/server.ts). The rules that matter — one active person per address, never no
 * active admin — are checked in modules/platform/people.ts, inside the transaction. Under the Mac's user
 * switcher anyone on the network can pick an admin, so nothing changes from here there.
 */
export type PeopleResult = { ok: true; message: string } | { ok: false; error: string } | null;

const SWITCHER = 'The roster is changed only on a deployed server with sign-in. On the Mac it comes from data/real/init.jsonc.';

async function guarded(work: () => Promise<string>): Promise<PeopleResult> {
  const { config } = await import('@/config/deployment');
  if (config.auth.provider !== 'google' && config.auth.provider !== 'labos') return { ok: false, error: SWITCHER };
  const { PeopleRefused } = await import('@/modules/platform');
  try {
    const message = await work();
    revalidatePath('/settings/people');
    return { ok: true, message };
  } catch (e) {
    if (e instanceof PeopleRefused) return { ok: false, error: e.message };
    throw e;
  }
}

const vehiclesOf = (formData: FormData): string[] | null =>
  formData.get('allVehicles') === 'on' ? null : formData.getAll('vehicle').map(String).filter(Boolean);
const accessOf = (formData: FormData) => String(formData.get('access') ?? '') as 'admin' | 'gp' | 'viewer';

export async function addPersonAction(_prev: PeopleResult, formData: FormData): Promise<PeopleResult> {
  const user = await requireAction('app/settings/people/actions.ts#addPersonAction', _prev, formData);
  return guarded(async () => {
    const { addPerson } = await import('@/modules/platform');
    const p = await addPerson(user.id, { name: String(formData.get('name') ?? ''), email: String(formData.get('email') ?? ''), access: accessOf(formData), vehicles: vehiclesOf(formData), role: String(formData.get('role') ?? '') });
    return `${p.name} can now sign in as ${p.email}.`;
  });
}

export async function updatePersonAction(_prev: PeopleResult, formData: FormData): Promise<PeopleResult> {
  const user = await requireAction('app/settings/people/actions.ts#updatePersonAction', _prev, formData);
  return guarded(async () => {
    const { updatePerson } = await import('@/modules/platform');
    const p = await updatePerson(user.id, String(formData.get('userId') ?? ''), { access: accessOf(formData), vehicles: vehiclesOf(formData) });
    return `${p.name} saved.`;
  });
}

export async function setPersonActiveAction(_prev: PeopleResult, formData: FormData): Promise<PeopleResult> {
  const user = await requireAction('app/settings/people/actions.ts#setPersonActiveAction', _prev, formData);
  return guarded(async () => {
    const { setPersonActive } = await import('@/modules/platform');
    const active = formData.get('active') === '1';
    const p = await setPersonActive(user.id, String(formData.get('userId') ?? ''), active);
    return active ? `${p.name} is active again. Old sessions stay ended.` : `${p.name} is deactivated and signed out everywhere.`;
  });
}

/** Sign a person out everywhere: their session epoch goes up, and every cookie they hold stops working. */
export async function signOutEverywhereAction(_prev: PeopleResult, formData: FormData): Promise<PeopleResult> {
  const user = await requireAction('app/settings/people/actions.ts#signOutEverywhereAction', _prev, formData);
  return guarded(async () => {
    const { appendAudit, raiseSessionEpoch } = await import('@/modules/platform');
    const id = String(formData.get('userId') ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return 'Nothing to do.';
    const epoch = await raiseSessionEpoch(id);
    if (epoch !== null) await appendAudit({ actorId: user.id, action: 'session.signed_out_everywhere', subjectType: 'app_user', subjectId: id, detail: { epoch } });
    return 'Signed out everywhere.';
  });
}
