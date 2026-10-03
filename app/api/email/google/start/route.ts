import { withRoute } from '@/lib/authz/route';

/**
 * Connect Gmail, step one (docs/25 §Per-user OAuth): remember a fresh state and PKCE verifier in a
 * short-lived cookie, and send the browser to Google's consent page — or the fake's, in the demo.
 */
export const GET = withRoute('app/api/email/google/start/route.ts#GET', async (request, _context, user) => {
  const { gmailRuntime, beginConnect } = await import('@/lib/connectors/gmail');
  const { PENDING_COOKIE, PENDING_MAX_AGE, requestOrigin, writePending } = await import('@/lib/email/pending');
  const origin = requestOrigin(request);
  const back = (outcome: string) => new Response(null, { status: 303, headers: { location: `${origin}/settings?gmail=${outcome}#email` } });
  if (user.access === 'viewer') return back('viewer');
  const rt = gmailRuntime(origin);
  if (rt.mode === 'off') return back('off');
  const { url, pending } = beginConnect(rt, user.handle, user.email);
  const headers = new Headers({ location: url });
  headers.append('set-cookie', `${PENDING_COOKIE}=${writePending(pending)}; Path=/; Max-Age=${PENDING_MAX_AGE}; HttpOnly; SameSite=Lax`);
  return new Response(null, { status: 303, headers });
});
