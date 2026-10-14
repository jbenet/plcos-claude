import { withRoute } from '@/lib/authz/route';

export const dynamic = 'force-dynamic';

/**
 * The desktop app's pairing (docs/31 §2, lib/desktop/pair.ts). Nobody is signed in on the app yet, so this is public;
 * what it hands out is decided by a signed-in person on /desktop/pair. `start` (a PKCE challenge and the app's
 * loopback port) returns a short code and the page's address; `claim` exchanges the one-time grant the browser
 * brought to the app's loopback address, with the verifier, for the person's session cookie.
 */
export const POST = withRoute('app/api/desktop/pair/route.ts#POST', async (request) => {
  const { claimPairing, startPairing, pairedCookie } = await import('@/lib/desktop/pair');
  const { publicUrl } = await import('@/lib/settings/setup');
  let body: { op?: unknown; device?: unknown; challenge?: unknown; port?: unknown; grant?: unknown; verifier?: unknown };
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'Send JSON.' }, { status: 400 }); }
  const base = publicUrl(request.headers);
  const headers = { 'cache-control': 'no-store' };
  if (body.op === 'start') {
    try {
      const { clientIp } = await import('@/lib/settings/floodgate');
      const p = startPairing(body.device, body.challenge, body.port, Date.now(), clientIp(request.headers));
      return Response.json({ ok: true, ...p, url: `${base}/desktop/pair?code=${encodeURIComponent(p.userCode)}` }, { headers });
    } catch (e) {
      return Response.json({ ok: false, error: e instanceof Error ? e.message : 'Could not start.' }, { status: 400, headers });
    }
  }
  if (body.op === 'claim') {
    const a = claimPairing(body.grant, body.verifier);
    if (!a) return Response.json({ ok: false, error: 'That grant is not valid (expired, used, or for another app).' }, { status: 403, headers });
    const cookie = await pairedCookie(a.user, base.startsWith('https://'));
    const { appendAudit } = await import('@/modules/platform');
    await appendAudit({ actorId: a.user.id, action: 'desktop.paired', subjectType: 'app_user', subjectId: a.user.id, detail: { device: a.device } });
    return Response.json({ ok: true, cookie, user: { handle: a.user.handle, name: a.user.name, access: a.user.access } }, { headers });
  }
  return Response.json({ ok: false, error: 'op must be start or claim.' }, { status: 400, headers });
});
