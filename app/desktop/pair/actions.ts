'use server';
import { redirect } from 'next/navigation';
import { requireAction } from '@/lib/authz/server';

/**
 * Allow or refuse the desktop app's pairing (docs/31 §2). The person allows it for themselves only: the app then
 * acts as whoever pressed Allow, with a session like the one Google sign-in gives them.
 */
export async function decidePairingAction(form: FormData): Promise<void> {
  const user = await requireAction('app/desktop/pair/actions.ts#decidePairingAction', form);
  const { decidePairing, normalizeCode } = await import('@/lib/desktop/pair');
  const code = normalizeCode(String(form.get('code') ?? ''));
  const allow = form.get('decision') === 'allow';
  const d = code ? decidePairing(code, user, allow) : null;
  if (d) {
    const { appendAudit } = await import('@/modules/platform');
    await appendAudit({ actorId: user.id, action: allow ? 'desktop.pair_allowed' : 'desktop.pair_refused', subjectType: 'app_user', subjectId: user.id, detail: { device: d.pending.device } });
  }
  // Allowed: on to the app's own loopback address on this machine, which finishes the sign-in (docs/31 §2).
  if (d?.redirect) redirect(d.redirect);
  redirect(`/desktop/pair?code=${encodeURIComponent(code ?? '')}&done=${d ? 'refused' : 'gone'}`);
}
