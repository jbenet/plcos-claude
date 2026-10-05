import { withRoute } from '@/lib/authz/route';

export const dynamic = 'force-dynamic';

/**
 * /setup's two steps (lib/settings/setup-service.ts): check the code, then finish. Public — nobody can be
 * signed in before Google sign-in exists — so the code is the credential, wrong ones are limited per
 * address and in total, and withRoute refuses a POST from any other origin.
 */
export const POST = withRoute('app/setup/submit/route.ts#POST', async (request) => {
  const { runSetup } = await import('@/lib/settings/setup-service');
  const { clientIp } = await import('@/lib/settings/floodgate');
  const text = await request.text();
  if (text.length > 20_000) return Response.json({ ok: false, field: null, error: 'Too much.' }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { return Response.json({ ok: false, field: null, error: 'The form did not arrive whole.' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ ok: false, field: null, error: 'The form did not arrive whole.' }, { status: 400 });
  const answer = await runSetup(body, { ip: clientIp(request.headers) });
  return Response.json(answer, { status: answer.ok ? 200 : answer.status, headers: { 'cache-control': 'no-store' } });
});
