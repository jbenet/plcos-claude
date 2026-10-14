import type { AppUser } from '@/modules/platform';

/**
 * What the desktop app's copy endpoints (sync and build) share with the whole-database snapshot: the same refusal
 * (only the live server hands out real data, never a copy of it) and an audit entry. A sync runs every few seconds
 * while the app is open, so it is logged once an hour per person, not per page; a build download every time.
 */
const g = globalThis as typeof globalThis & { __desktopAudited?: Map<string, number> };
const HOUR = 60 * 60_000;

export async function desktopRefusal(user: AppUser, what: 'sync' | 'build'): Promise<Response | null> {
  const { snapshotRefusal } = await import('@/lib/sync/snapshot');
  const refusal = snapshotRefusal();
  if (!refusal) return null;
  await auditDesktop(user, what, { outcome: 'refused', reason: 'profile' }, true);
  return Response.json({ ok: false, error: refusal }, { status: 403, headers: { 'cache-control': 'no-store' } });
}

export async function auditDesktop(user: AppUser, what: 'sync' | 'build', detail: Record<string, unknown>, always = what === 'build', now = Date.now()): Promise<void> {
  const seen = (g.__desktopAudited ??= new Map());
  const key = `${user.id}:${what}`;
  if (!always && now - (seen.get(key) ?? 0) < HOUR) return;
  seen.set(key, now);
  const { appendAudit } = await import('@/modules/platform');
  await appendAudit({ actorId: user.id, action: `desktop.${what}`, subjectType: 'app_user', subjectId: user.id, detail });
}
