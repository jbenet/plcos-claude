import { withRoute } from '@/lib/authz/route';

/**
 * The demo's stand-in for Google's consent page (docs/25 §Testing): it says "Allow" at once and
 * sends the browser back with a code, as Google would. Demo profile only; elsewhere, not found.
 */
export const GET = withRoute('app/api/email/google/fake-consent/route.ts#GET', async (request) => {
  const { config } = await import('@/config/deployment');
  if (config.data.profile !== 'demo') return new Response('Not found', { status: 404 });
  const { fakeConsent, fakeDir } = await import('@/lib/connectors/gmail');
  const { requestOrigin } = await import('@/lib/email/pending');
  const url = new URL(request.url);
  const redirect = url.searchParams.get('redirect_uri') ?? '';
  // The fake answers only its own server's callback, as Google answers only registered ones.
  if (!redirect.startsWith(`${requestOrigin(request)}/api/email/google/callback`)) return new Response('Unregistered redirect', { status: 400 });
  return new Response(null, { status: 303, headers: { location: await fakeConsent(fakeDir(), url.searchParams) } });
});
