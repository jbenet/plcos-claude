import { withRoute } from '@/lib/authz/route';

export const dynamic = 'force-dynamic';

/** Connect DocSend, step one (docs/32-docsend.md §4 E): register, PKCE and a signed state cookie, then DocSend. Admins only. */
export const GET = withRoute('app/api/connectors/docsend/connect/route.ts#GET', async (request, _context, user) => {
  const { settingsReady } = await import('@/lib/settings/store');
  const { publicUrl } = await import('@/lib/settings/setup');
  const { startDocsendConnect } = await import('@/lib/connectors/docsend/signin');
  await settingsReady().catch(() => undefined);
  return startDocsendConnect(user, publicUrl(request.headers));
});
