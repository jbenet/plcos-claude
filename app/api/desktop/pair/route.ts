import { withRoute } from '@/lib/authz/route';

export const dynamic = 'force-dynamic';

/**
 * The desktop app's pairing (docs/31 §2). Nobody is signed in on the app yet, so this is public; what it hands out
 * is decided by a signed-in person on /desktop/pair. `start` returns a secret device code and a short code;
 * `poll` with the device code returns pending, denied, expired, or (once) the person's session cookie.
 */
export const POST = withRoute('app/api/desktop/pair/route.ts#POST', async (request) => {
  const { pollPairing, startPairing, pairedCookie } = await import('@/lib/desktop/pair');
  const { publicUrl } = await import('@/lib/settings/setup');
  let body: { op?: unknown; device?: unknown; deviceCode?: unknown };
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'Send JSON.' }, { status: 400 }); }
  const base = publicUrl(request.headers);
  const headers = { 'cache-control': 'no-store' };
  if (body.op === 'start') {
    try {
      const p = startPairing(body.device);
      return Response.json({ ok: true, ...p, url: `${base}/desktop/pair?code=${encodeURIComponent(p.userCode)}` }, { headers });
    } catch (e) {
      return Response.json({ ok: false, error: e instanceof Error ? e.message : 'Could not start.' }, { status: 429, headers });
    }
  }
  if (body.op === 'poll') {
    const a = pollPairing(body.deviceCode);
    if (a.state !== 'approved') return Response.json({ ok: true, state: a.state }, { headers });
    const cookie = await pairedCookie(a.user, base.startsWith('https://'));
    const { appendAudit } = await import('@/modules/platform');
    await appendAudit({ actorId: a.user.id, action: 'desktop.paired', subjectType: 'app_user', subjectId: a.user.id, detail: { device: a.device } });
    return Response.json({ ok: true, state: 'approved', cookie, user: { handle: a.user.handle, name: a.user.name, access: a.user.access } }, { headers });
  }
  return Response.json({ ok: false, error: 'op must be start or poll.' }, { status: 400, headers });
});
