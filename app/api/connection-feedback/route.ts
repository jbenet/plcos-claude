/**
 * A connection note: journal first, save after, like the feedback box (app/api/feedback/route.ts).
 * POST checks the note's shape, writes it to the server's journal and answers 202 at once. The
 * author and the LP are checked against the database afterwards, by the ingester
 * (lib/feedback-ingest.ts), which saves it through saveConnectionFeedback — deduped on the id — or
 * moves it to inbox/refused/ with the reason. Static imports stay light (a property checks them).
 */
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { config } from '@/config/deployment';
import { USER_COOKIE } from '@/lib/auth/cookie';
import { feedbackInput } from '@/lib/enrich/feedback';
import { isClientId } from '@/lib/feedback-journal';
import { inboxStatus, journal } from '@/lib/feedback-inbox';

const issuesRoot = () => join(process.cwd(), config.issues.dir);
const fileLater = () => setImmediate(() => {
  void import('@/lib/feedback-ingest').then((m) => m.kickIngest()).catch(() => undefined);
});

export async function POST(req: Request) {
  // Same-origin only. Compared with the Host the browser asked for: the URL Next hands the route names
  // the address it bound (0.0.0.0, localhost), which never equals the page's own origin.
  const origin = req.headers.get('origin');
  if (origin && !sameHost(origin, req.headers.get('host'))) return NextResponse.json({ error: 'Use the feedback box on this server.' }, { status: 403 });
  let input;
  try { input = feedbackInput(await req.json()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid feedback.' }, { status: 400 }); }
  try {
    const reporter = (await cookies()).get(USER_COOKIE)?.value || null;
    const done = await journal(issuesRoot(), {
      kind: 'connection', clientId: input.id, receivedAt: new Date().toISOString(), reporter,
      request: { lp: input.lp, page: input.page, text: input.text },
    });
    fileLater();
    return NextResponse.json({ journaled: true, clientId: input.id, repeat: done.already !== null }, { status: 202 });
  } catch {
    return NextResponse.json({ error: 'The server could not save the note. It is kept in your browser and sent again; retries do not duplicate it.' }, { status: 500 });
  }
}

/** Where a journaled note stands. Reads the journal only. */
export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get('clientId') ?? '';
  if (!isClientId(clientId)) return NextResponse.json({ error: 'Give a clientId.' }, { status: 400 });
  const status = await inboxStatus(issuesRoot(), clientId);
  if (!status) return NextResponse.json({ state: 'unknown' }, { status: 404 });
  if (status.state === 'journaled') fileLater();
  return NextResponse.json(status.state === 'refused' ? { state: 'refused', error: status.reason } : { state: status.state });
}

function sameHost(origin: string, host: string | null): boolean {
  try { return Boolean(host) && new URL(origin).host === host; } catch { return false; }
}
