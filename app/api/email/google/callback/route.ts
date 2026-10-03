import { withRoute } from '@/lib/authz/route';

/**
 * Connect Gmail, step two: Google sends the browser back here with a code. The state must match
 * the cookie this browser was given, and the person must be the one who started; then the code is
 * exchanged (with the PKCE verifier), the grant checked to be no wider than asked, and the refresh
 * token stored for this person alone. Audit-logged. The answer is a redirect to Preferences.
 */
export const GET = withRoute('app/api/email/google/callback/route.ts#GET', async (request, _context, user) => {
  const { finishGmailConnect, DraftRefused } = await import('@/modules/email');
  const { PENDING_COOKIE, readPending, requestOrigin } = await import('@/lib/email/pending');
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const back = (outcome: string) => {
    const headers = new Headers({ location: `${origin}/settings?gmail=${outcome}#email` });
    headers.append('set-cookie', `${PENDING_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    return new Response(null, { status: 303, headers });
  };
  if (user.access === 'viewer') return back('viewer');
  const cookie = request.headers.get('cookie') ?? '';
  const raw = cookie.split(/;\s*/).find((c) => c.startsWith(`${PENDING_COOKIE}=`))?.slice(PENDING_COOKIE.length + 1);
  const pending = readPending(raw);
  if (url.searchParams.get('error')) return back('declined');
  const code = url.searchParams.get('code');
  if (!pending || !code || url.searchParams.get('state') !== pending.state) return back('mismatch');
  try {
    await finishGmailConnect(user, origin, code, pending);
    return back('connected');
  } catch (e) {
    if (e instanceof DraftRefused || (e instanceof Error && ['OAuthError', 'DraftOnlyViolation', 'GmailError'].includes(e.name))) return back('failed');
    throw e;
  }
});
