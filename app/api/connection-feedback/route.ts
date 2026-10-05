import { withRoute } from '@/lib/authz/route';
/**
 * A connection note: journal first, save after, like the feedback box (app/api/feedback/route.ts).
 * POST checks origin and live profile, then checks the note's
 * shape, writes it to the journal and answers 202. The LP is checked afterwards by the ingester
 * (lib/feedback-ingest.ts), which saves it through saveConnectionFeedback — deduped on the id — or
 * moves it to inbox/refused/ with the reason. Static imports stay light (a property checks them).
 */
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { config } from '@/config/deployment';
import { feedbackInput } from '@/lib/enrich/feedback';
import { isClientId } from '@/lib/feedback-journal';
import { inboxStatus, journal } from '@/lib/feedback-inbox';

const issuesRoot = () => join(process.cwd(), config.issues.dir);
const fileLater = () => setImmediate(() => {
  void import('@/lib/feedback-ingest').then((m) => m.kickIngest()).catch(() => undefined);
});

export const POST = withRoute('app/api/connection-feedback/route.ts#POST', async function(req: Request) {
  const { feedbackReporter } = await import('@/lib/auth/reporter');
  const who = await feedbackReporter();
  if ('refused' in who) return who.refused;
  let input;
  try { input = feedbackInput(await req.json()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid feedback.' }, { status: 400 }); }
  try {
    const reporter = who.reporter;
    const done = await journal(issuesRoot(), {
      kind: 'connection', clientId: input.id, receivedAt: new Date().toISOString(), reporter,
      request: { lp: input.lp, page: input.page, text: input.text },
    });
    fileLater();
    return NextResponse.json({ journaled: true, clientId: input.id, repeat: done.already !== null }, { status: 202 });
  } catch {
    return NextResponse.json({ error: 'The server could not save the note. It is kept in your browser and sent again; retries do not duplicate it.' }, { status: 500 });
  }
});

/** Where a journaled note stands. Reads the journal only. */
export const GET = withRoute('app/api/connection-feedback/route.ts#GET', async function(req: Request) {
  const clientId = new URL(req.url).searchParams.get('clientId') ?? '';
  if (!isClientId(clientId)) return NextResponse.json({ error: 'Give a clientId.' }, { status: 400 });
  const status = await inboxStatus(issuesRoot(), clientId);
  if (!status) return NextResponse.json({ state: 'unknown' }, { status: 404 });
  return NextResponse.json(status.state === 'refused' ? { state: 'refused', error: status.reason } : { state: status.state });
});
