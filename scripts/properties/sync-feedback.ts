import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { syncGuard } from '../../lib/sync/auth';
import { SYNC_ADMIN, SYNC_PUSH } from '../../lib/sync/scopes';
import { readFeedback, setFeedbackStatus } from '../../lib/sync/feedback';
import { fileIssueSink } from '../../lib/issues/file';
import { createMcpToken, type AppUser } from '../../modules/platform';
import { freshDb, type Check } from './harness';

/**
 * The feedback queue by token (lib/sync/feedback.ts) on invented issues in a scratch folder: only an Admin token
 * opens it; the open view carries no issue text; ids return the text; a file is served only when the issue lists
 * it; a status change writes closed_at and the note, and bad input changes nothing.
 */
export async function syncFeedbackProperties(check: Check) {
  const db = await freshDb();
  const sel = 'id::text, handle, name, initials, role, email, access::text, vehicles, approves';
  const juan = (await db.one<AppUser>(`select ${sel} from platform.app_user where handle = 'juan'`))!;
  const mint = (tools: string[]) => createMcpToken(juan, { label: 'props feedback', tools, vehicles: null, callsPerDay: 100, days: 30 }, db);
  const admin = await mint([SYNC_ADMIN]), pushOnly = await mint([SYNC_PUSH]);
  const abs = await mkdtemp(join(tmpdir(), 'plcos-feedback-'));
  // The sink takes a folder relative to the working directory, as config.issues.dir is.
  const dir = relative(process.cwd(), abs);
  try {
    const sink = fileIssueSink(dir);
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const draft = { body: 'Invented body: the button is grey.', kind: 'bug' as const, priority: 'P2' as const, reporter: 'Invented', page: '/overview', labels: [], context: null };
    const a = await sink.create({ ...draft, title: 'Invented issue one', attachments: [{ kind: 'screenshot', contentType: 'image/png', base64: pixel }] });
    const b = await sink.create({ ...draft, title: 'Invented issue two' });
    await sink.update(b.id, { status: 'triaged' });

    const req = (secret: string, q: string, body?: unknown) => new Request(`http://localhost:3119/api/sync/feedback${q}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${secret}` }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    const get = async (secret: string, q: string) => {
      const g = await syncGuard(req(secret, q), 'feedback');
      if ('response' in g) return { status: g.response.status, body: {} as Record<string, any> };
      return readFeedback(g.caller, req(secret, q), { sink, dir }) as Promise<any>;
    };
    const post = async (secret: string, body: unknown) => {
      const g = await syncGuard(req(secret, '', body), 'feedback');
      if ('response' in g) return { status: g.response.status, body: {} as Record<string, any> };
      return setFeedbackStatus(g.caller, req(secret, '', body), { sink, dir }) as Promise<any>;
    };

    const byPush = await get(pushOnly.secret, '?view=open');
    const postByPush = await post(pushOnly.secret, { id: a.id, status: 'done' });
    check('Feedback by token: a push token can neither read nor change the queue', byPush.status === 403 && postByPush.status === 403, `${byPush.status} ${postByPush.status}`);

    const open = await get(admin.secret, '?view=open'), active = await get(admin.secret, '?view=active');
    const text = JSON.stringify(open.body);
    check('Feedback by token: the open view lists only untouched issues, with no title, body or reporter',
      open.status === 200 && open.body.items.length === 1 && open.body.items[0].id === a.id && open.body.items[0].attachments === 1
      && !text.includes('Invented issue') && !text.includes('grey') && active.body.items.length === 2, `${open.status} ${text.slice(0, 120)}`);

    const read = await get(admin.secret, `?ids=${a.id},${b.id},9999`);
    const shot = await get(admin.secret, `?id=${a.id}&file=${encodeURIComponent(a.attachments[0]!)}`);
    const wrongIssue = await get(admin.secret, `?id=${b.id}&file=${encodeURIComponent(a.attachments[0]!)}`);
    const escape = await get(admin.secret, `?id=${a.id}&file=${encodeURIComponent('../../package.json')}`);
    const badIds = await get(admin.secret, '?ids=../x');
    check('Feedback by token: ids return the text and the missing ids; a file only when that issue lists it',
      read.status === 200 && read.body.items.length === 2 && read.body.items[0].markdown?.includes('grey') && read.body.missing.join() === '9999'
      && shot.status === 200 && shot.type === 'image/png' && shot.bytes.length > 0 && wrongIssue.status === 404 && escape.status === 404 && badIds.status === 400,
      `${read.status} ${shot.status} ${wrongIssue.status} ${escape.status} ${badIds.status}`);

    const badStatus = await post(admin.secret, { id: a.id, status: 'closed' });
    const extra = await post(admin.secret, { id: a.id, status: 'done', title: 'x' });
    const unknown = await post(admin.secret, { id: '9999', status: 'done' });
    const notJson = await post(admin.secret, '{');
    const untouched = await sink.get(a.id);
    const done = await post(admin.secret, { id: a.id, status: 'done', note: '**Done (N999).** Invented closing note.' });
    const after = await sink.get(a.id);
    const openAfter = await get(admin.secret, '?view=open');
    check('Feedback by token: bad input changes nothing; done sets closed_at, appends the note and leaves the open view',
      badStatus.status === 422 && extra.status === 422 && unknown.status === 404 && notJson.status === 400 && untouched?.status === 'open'
      && done.status === 200 && after?.status === 'done' && Boolean(after.closedAt) && after.fixedIn === 'N999' && after.body.includes('grey')
      && openAfter.body.items.length === 0,
      `${badStatus.status} ${extra.status} ${unknown.status} ${notJson.status} ${done.status} ${after?.status} ${after?.fixedIn}`);

    const audit = await db.query<{ detail: Record<string, any> }>(`select detail from platform.audit_log where action = 'mcp.call' and subject_id = $1`, [admin.token.tokenId]);
    check('Feedback by token: every call is audited, and no audit row carries issue text',
      audit.length >= 10 && audit.every((r) => r.detail.tool === 'feedback_queue' && !JSON.stringify(r.detail).includes('grey') && !JSON.stringify(r.detail).includes('Invented')),
      `${audit.length} rows`);
  } finally {
    await rm(abs, { recursive: true, force: true });
  }
}
