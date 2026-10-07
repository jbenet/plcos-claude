/**
 * Files what the feedback routes journaled (lib/feedback-inbox.ts), off the request path.
 *
 * One run at a time per process (a kick during a run asks for one more pass). It runs right after
 * each journal write, when the server starts (instrumentation.ts), and every 10 s. Each entry goes
 * through the writer that was always used — fileFeedback for a report, saveConnectionFeedback for a
 * connection note — and both dedupe on the client id, so an entry filed twice is one issue. A filed
 * entry moves to inbox/filed/; one that fails (a busy database, a disk error) stays and is tried on
 * the next pass; one that can never be filed moves to inbox/refused/ with the reason.
 *
 * The issue file is the record. The database row and the audit entry are best effort, written by
 * fileFeedback when the database answers, as background work, for up to two minutes
 * (modules/platform/service.ts).
 */
import { join } from 'node:path';
import { config } from '@/config/deployment';
import type { QueueClock } from '@/lib/db/scheduling';
import type { IssueSink } from '@/lib/issues';
import { attachmentsOf, inboxIds, markFiled, markRefused, readEntry, type InboxEntry } from './feedback-inbox';

/** GUESS: often enough that a missed kick costs seconds, rare enough to cost nothing. */
export const INGEST_EVERY_MS = 10_000;
/** GUESS: how long a filed report's database row may wait for a busy database before it is dropped (the issue file stays the record). */
export const METADATA_WAIT_MS = 120_000;

export interface IngestOptions {
  /** The issues folder; the profile's own by default. */
  issuesRoot?: string;
  sink?: IssueSink;
  clock?: QueueClock;
  /** Where connection notes are kept; `<data root>/enrich` by default. */
  enrichRoot?: string;
  /** Files one report; fileFeedback by default. The properties pass a sink-only writer, with no database. */
  fileIssue?: (entry: Extract<InboxEntry, { kind: 'issue' }>) => Promise<{ id: string | null; location: string | null; title: string }>;
}

export interface IngestResult { filed: number; refused: number; failed: number; waiting: number }

const g = globalThis as typeof globalThis & {
  __capitalOsIngest?: { running: Promise<IngestResult> | null; again: boolean; timer: ReturnType<typeof setInterval> | null; logged: Set<string> };
};
const state = (g.__capitalOsIngest ??= { running: null, again: false, timer: null, logged: new Set() });

export const defaultIssuesRoot = () => join(process.cwd(), config.issues.dir);

class Refusal extends Error {}

async function fileOne(entry: InboxEntry, opts: IngestOptions): Promise<{ id: string | null; location: string | null; title: string }> {
  if (entry.kind === 'issue' && opts.fileIssue) return opts.fileIssue(entry);
  if (entry.kind === 'issue') {
    const [{ fileFeedback }, { withBackgroundDb }, { resolveLocalUser }] = await Promise.all([
      import('@/modules/platform'), import('@/lib/db/scheduling'), import('@/lib/auth/local-user'),
    ]);
    const r = entry.request;
    // Resolve identity off the request, at background priority behind page reads. After the
    // file is durable, metadata may wait up to METADATA_WAIT_MS without delaying that receipt.
    const issue = await withBackgroundDb(async () => {
      // Resolve before writing the issue receipt. A busy or failed lookup leaves the durable
      // journal pending; only a successful lookup with no active users means unknown.
      const user = await resolveLocalUser(entry.reporter);
      // A signed session's reporter (lib/auth/reporter.ts) whose person is gone or was signed out everywhere
      // since: refused, never filed as nobody.
      if (!user && entry.reporter?.startsWith('uid:')) throw new Refusal('Your session ended before this was filed. Sign in and send it again.');
      return fileFeedback(user, {
        title: r.title.trim() || r.body, body: r.body, kind: r.kind as never, priority: r.priority as never,
        page: r.page, context: { ...r.context, journaledAt: entry.receivedAt }, attachments: attachmentsOf(r),
        imageOffset: r.imageOffset, clientId: entry.clientId,
      }, { metadataBudgetMs: METADATA_WAIT_MS, ...(opts.sink ? { sink: opts.sink } : {}), ...(opts.clock ? { clock: opts.clock } : {}) });
    });
    return { id: issue.id, location: issue.location, title: issue.title };
  }

  // A connection note needs its author and its LP, both from the database. Busy: it waits.
  const [{ resolveLocalUser }, { getEntity }, { feedbackInput, saveConnectionFeedback }] = await Promise.all([
    import('@/lib/auth/local-user'), import('@/modules/identity'), import('@/lib/enrich/feedback'),
  ]);
  let input;
  try { input = feedbackInput({ id: entry.clientId, ...entry.request }); } catch (e) { throw new Refusal(e instanceof Error ? e.message : 'Invalid note.'); }
  // As the route did before the journal: the cookie's user, else the first active one (lib/auth/local.ts).
  const user = await resolveLocalUser(entry.reporter);
  if (!user) throw new Refusal('No active team member for this note. Choose one in the rail and write it again.');
  if (!await getEntity(input.lp)) throw new Refusal('This LP is no longer available.');
  const enrich = opts.enrichRoot ?? join(process.cwd(), config.data.root, 'enrich');
  await saveConnectionFeedback(enrich, {
    ...input, author: { id: user.id, handle: user.handle, name: user.name }, at: entry.receivedAt,
  });
  return { id: null, location: null, title: `Connection note: ${input.text.slice(0, 60)}` };
}

async function pass(opts: IngestOptions): Promise<IngestResult> {
  const root = opts.issuesRoot ?? defaultIssuesRoot();
  const result: IngestResult = { filed: 0, refused: 0, failed: 0, waiting: 0 };
  const filedIssues: string[] = [];
  for (const id of await inboxIds(root)) {
    const entry = await readEntry(root, id);
    if (!entry) continue; // filed by a pass in another module instance a moment ago
    try {
      const issue = await fileOne(entry, opts);
      await markFiled(root, entry, issue);
      result.filed += 1;
      if (entry.kind === 'issue' && issue.id) filedIssues.push(issue.id);
    } catch (err) {
      if (err instanceof Refusal) {
        await markRefused(root, entry, err.message);
        result.refused += 1;
        console.warn(`[feedback] refused ${id}: ${err.message}`);
        continue;
      }
      result.failed += 1;
      if (!state.logged.has(id)) {
        state.logged.add(id);
        console.warn(`[feedback] ${id} stays in the inbox and is retried: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  result.waiting = (await inboxIds(root)).length;
  // Wake the feedback thread once the box is quiet (lib/feedback-signal); a test's own sink signals nothing.
  if (!opts.fileIssue) {
    const { signalAfterPass } = await import('@/lib/feedback-signal');
    await signalAfterPass(root, filedIssues);
  }
  return result;
}

/** One pass now, or one more after the running one. Never throws. */
export function ingestInbox(opts: IngestOptions = {}): Promise<IngestResult> {
  if (state.running) {
    state.again = true;
    return state.running;
  }
  const run = (async () => {
    let last: IngestResult = { filed: 0, refused: 0, failed: 0, waiting: 0 };
    try {
      do {
        state.again = false;
        last = await pass(opts);
      } while (state.again);
    } catch (err) {
      console.warn('[feedback] ingest pass failed:', err instanceof Error ? err.message : err);
    }
    return last;
  })();
  state.running = run;
  void run.finally(() => { if (state.running === run) state.running = null; });
  return run;
}

/** After the response is sent, and on the timer from then on. */
export function kickIngest(): void {
  startIngest();
  setImmediate(() => { void ingestInbox(); });
}

/** The timer, once per process. The first pass runs at once: what a restart left in the inbox. */
export function startIngest(): void {
  if (state.timer) return;
  state.timer = setInterval(() => { void ingestInbox(); }, INGEST_EVERY_MS);
  state.timer.unref?.();
  setImmediate(() => { void ingestInbox(); });
}
