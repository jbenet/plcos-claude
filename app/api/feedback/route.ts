import { withRoute } from '@/lib/authz/route';
/**
 * The feedback box's route: journal first, file after (Juan, 27 Sep: "it should journal to the
 * server. the page may die or close forever").
 *
 * POST checks origin and profile, then journals the report without database access.
 * The ingester resolves the reporter from the captured selector after the response.
 * Static imports stay light; the ingester is loaded only after journaling.
 */
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { config } from '@/config/deployment';
import { feedbackHome } from '@/config/ports';
import { USER_COOKIE } from '@/lib/auth/cookie';
import { isClientId } from '@/lib/feedback-journal';
import { checkReport, inboxStatus, journal } from '@/lib/feedback-inbox';
import { newRequestKey } from '@/lib/request-key';

const issuesRoot = () => join(process.cwd(), config.issues.dir);

/** Filing happens here, after the response: the ingester's own module, loaded when first needed. */
const fileLater = () => setImmediate(() => {
  void import('@/lib/feedback-ingest').then((m) => m.kickIngest()).catch(() => undefined);
});

export const POST = withRoute('app/api/feedback/route.ts#POST', async function(req: Request) {
  // Origin and profile only: no database here. The journal must accept a note while the database is busy
  // (docs/deploy/03); the reporter is resolved server-side at ingest from the selector cookie.
  // Only the live app files (docs/COLLAB.md): a branch filing would take numbers the live app
  // gives out too. The box on a dev worktree says so; this refuses anything that asks anyway.
  if (!feedbackHome(config.data.profile).filesHere) {
    return NextResponse.json(
      { error: 'This server runs a branch in development. Feedback is filed from the live app, so issue numbers never collide (docs/COLLAB.md).' },
      { status: 403 },
    );
  }
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'The report did not arrive whole. It is still in your browser; it will be sent again.' }, { status: 400 });
  }
  // A resend after a timeout must not file twice: the client id names the journal file, and the
  // writer dedupes on it. A malformed one is refused, not replaced; none at all (an old tab) gets one.
  if (raw.clientId !== undefined && !isClientId(raw.clientId)) {
    return NextResponse.json({ error: 'The report\'s client id is malformed.' }, { status: 400 });
  }
  const clientId = (raw.clientId as string | undefined) ?? newRequestKey();
  const checked = checkReport(raw);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status });

  try {
    // Capture only the local selector here. Ingest resolves app_user before naming the reporter;
    // a reporter supplied in the request body is never used.
    const reporter = (await cookies()).get(USER_COOKIE)?.value || null;
    const done = await journal(issuesRoot(), {
      kind: 'issue', clientId, receivedAt: new Date().toISOString(), reporter, request: checked.value,
    });
    fileLater();
    return NextResponse.json({
      journaled: true, clientId, repeat: done.already !== null,
      ...(done.filed?.issueId ? { id: done.filed.issueId } : {}),
    }, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      { error: `The server could not save it: ${err instanceof Error ? err.message : 'unknown error'}. It is still in your browser and will be sent again.` },
      { status: 500 },
    );
  }
});

/** Where a journaled report stands: { state: 'journaled' | 'filed' | 'refused', id? }. Reads the journal only. */
export const GET = withRoute('app/api/feedback/route.ts#GET', async function(req: Request) {
  const clientId = new URL(req.url).searchParams.get('clientId') ?? '';
  if (!isClientId(clientId)) return NextResponse.json({ error: 'Give a clientId.' }, { status: 400 });
  const status = await inboxStatus(issuesRoot(), clientId);
  if (!status) return NextResponse.json({ state: 'unknown' }, { status: 404 });
  return NextResponse.json(status.state === 'filed'
    ? { state: 'filed', id: status.issueId }
    : status.state === 'refused' ? { state: 'refused', error: status.reason } : { state: 'journaled' });
});
