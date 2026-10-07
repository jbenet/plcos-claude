import { withRoute } from '@/lib/authz/route';
/**
 * The app's feedback queue by an Admin's token (lib/sync/feedback.ts; docs/deploy/07-feedback-signal.md §6):
 * list open issues, read them and their screenshots, set an issue's status.
 */
export const dynamic = 'force-dynamic';

export const GET = withRoute('app/api/sync/feedback/route.ts#GET', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { readFeedback } = await import('@/lib/sync/feedback');
  const answer = await readFeedback(context.caller, request);
  if ('bytes' in answer) return new Response(answer.bytes, { headers: { 'Cache-Control': 'no-store', 'Content-Type': answer.type } });
  return Response.json(answer.body, { status: answer.status, headers: { 'Cache-Control': 'no-store' } });
});

export const POST = withRoute('app/api/sync/feedback/route.ts#POST', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { setFeedbackStatus } = await import('@/lib/sync/feedback');
  const { status, body } = await setFeedbackStatus(context.caller, request);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
});
