/**
 * Cloud pull and push (docs/deploy/railway.md §6–§7), on invented data, the demo profile and the test
 * cluster only. Never the live checkout, the live cluster (:57433) or real data.
 *   - scopes (lib/sync/scopes.ts, in the MCP token's tools like the outreach scopes): only an Admin mints a
 *     snapshot token, a Viewer no push token; a push token cannot snapshot, a snapshot token cannot push, an
 *     MCP token can do neither, and a sync token lists and calls no MCP tool;
 *     a revoked token, a demoted owner and a browser Origin are refused; every refusal is audited;
 *   - push: the importer's validators and the Dakota refusal answer every reason by file and write nothing;
 *     an accepted push is kept in the inbox, published, recorded in the ledger and queues the import once;
 *     the same push again is a duplicate; an older file never replaces a newer one; a W1c review is graded
 *     against the server's finding; the audit carries no file words;
 *   - snapshot: PGlite and an unflagged demo refuse; one at a time; the files archive leaves out what
 *     cutover-files.sh leaves out, by the same lists; on Postgres, the round trip through
 *     scripts/cloud-pull.sh into a scratch cluster on a free port matches every table's row count, and
 *     --keep writes an encrypted copy that opens with the passphrase.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createServer as netServer } from 'node:net';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPostgres } from '../../lib/db/postgres';
import { config } from '../../config/deployment';
import { readRuns } from '../../lib/workflows/ledger';
import { syncGuard } from '../../lib/sync/auth';
import { bundleHash } from '../../lib/sync/bundle';
import { dakotaClaims } from '../../lib/sync/dakota';
import { EXCLUDE_DIRS, EXCLUDE_FILES, EXPORTS, filesToCarry } from '../../lib/sync/files';
import { acceptPush } from '../../lib/sync/push';
import { snapshotResponse } from '../../lib/sync/snapshot';
import { SYNC_PUSH, SYNC_SNAPSHOT } from '../../lib/sync/scopes';
import { createMcpToken, revokeMcpToken, TokenRefused, type AppUser } from '../../modules/platform';
import type { Check, Db } from './harness';

const PG_BIN = '/opt/homebrew/opt/postgresql@17/bin';
const WORD = 'INVENTED_SYNC_WORD';

const finding = (key: string, at: string, extra: Record<string, unknown> = {}) => ({
  key, name: `Invented ${key}`, researched: { at, by: 'props', workflow: 'W1', version: '1.50' },
  identity: { match: 'confirmed', basis: `Invented basis ${WORD}` },
  facts: [{ field: 'location', value: `Fargo, North Dakota ${WORD}`, source: { url: 'https://example.org/north-dakota/invented', kind: 'press', title: 'Invented page' }, confidence: 'high', quote: 'Invented quote' }],
  ...extra,
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = netServer().listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
    s.once('error', reject);
  });
}
const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv) => new Promise<{ code: number | null; out: string }>((resolve) => {
  const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  child.once('close', (code) => resolve({ code, out }));
});

export async function syncProperties(check: Check, db: Db) {
  const { GET } = await import('../../app/api/sync/snapshot/route');
  const { POST } = await import('../../app/api/sync/push/route');
  const { POST: MCP } = await import('../../app/api/mcp/route');
  const base = 'http://localhost:3119';
  const get = (secret: string | null, query = '', headers: Record<string, string> = {}) =>
    GET(new Request(`${base}/api/sync/snapshot${query}`, { headers: { ...(secret ? { authorization: `Bearer ${secret}` } : {}), ...headers } }));
  const pushReq = (secret: string, body: unknown) => new Request(`${base}/api/sync/push`, {
    method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const post = (secret: string, body: unknown) => POST(pushReq(secret, body));

  // ── Fixtures: invented users ─────────────────────────────────────────────────────────────
  const juan = (await db.one<AppUser>(`select id::text, handle, name, initials, role, email, access::text, vehicles, approves from platform.app_user where handle = 'juan'`))!;
  const user = async (handle: string, access: string) => (await db.one<AppUser>(`insert into platform.app_user (handle, name, initials, role, email, access, vehicles)
    values ($1, $2, 'IS', 'Invented (props)', $3, $4::platform.access_role, null) on conflict (handle) do update set active = true, access = excluded.access, vehicles = excluded.vehicles
    returning id::text, handle, name, initials, role, email, access::text, vehicles::text[], approves`, [handle, `Invented ${handle}`, `${handle}@example.invalid`, access]))!;
  const gp = await user('sync-gp', 'gp');
  const viewer = await user('sync-viewer', 'viewer');
  const admin2 = await user('sync-admin', 'admin');
  const mint = async (owner: AppUser, scope: 'snapshot' | 'push') => createMcpToken(owner,
    { label: `props ${scope}`, tools: [scope === 'snapshot' ? SYNC_SNAPSHOT : SYNC_PUSH], vehicles: null, callsPerDay: 100, days: 30 }, db);

  // ── Minting ────────────────────────────────────────────────────────────────────────────
  const refusedMint = async (owner: AppUser, scope: 'snapshot' | 'push') => { try { await mint(owner, scope); return false; } catch (e) { return e instanceof TokenRefused; } };
  const gpSnap = await refusedMint(gp, 'snapshot'), viewerPush = await refusedMint(viewer, 'push'), viewerSnap = await refusedMint(viewer, 'snapshot');
  const snap = await mint(juan, 'snapshot'), push = await mint(gp, 'push'), adminPush = await mint(juan, 'push');
  const mcp = (await createMcpToken(juan, { label: 'props sync mcp', tools: ['search'], vehicles: null, callsPerDay: 100, days: 30 }, db)).secret;
  const stored = await db.query<{ tools: string[]; prefix: string; token_hash: string }>(`select tools, prefix, token_hash from platform.mcp_token where token_id = any($1::uuid[])`, [[snap.token.tokenId, push.token.tokenId]]);
  check('SYNC tokens: only an Admin mints a snapshot token and a Viewer mints no push token; stored hashed, the scope alone in the token\'s tools',
    gpSnap && viewerPush && viewerSnap && snap.secret.startsWith('plcos_mcp_')
    && stored.length === 2 && stored.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash) && !r.token_hash.includes(snap.secret) && r.prefix.length < 20)
    && stored.map((r) => r.tools.join()).sort().join(' ') === `${SYNC_PUSH} ${SYNC_SNAPSHOT}`,
    `GP snapshot refused: ${gpSnap}; Viewer push refused: ${viewerPush}; tools ${stored.map((r) => r.tools.join()).sort().join(', ')}`);

  // ── Scope, per use ─────────────────────────────────────────────────────────────────────
  const auditOf = async (tokenId: string) => db.query<{ action: string; detail: Record<string, any> }>(`select action, detail from platform.audit_log where subject_id = $1 and action in ('mcp.call', 'mcp.refused') order by id`, [tokenId]);
  const pushOnSnap = await get(push.secret);
  const snapOnPush = await post(snap.secret, { workflow: 'W1', files: [] });
  const mcpOnSnap = await get(mcp);
  const mcpCall = async (body: Record<string, unknown>) => (await MCP(new Request(`${base}/api/mcp`, { method: 'POST',
    headers: { authorization: `Bearer ${push.secret}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }) }))).json().catch(() => ({})) as Record<string, any>;
  const syncList = await mcpCall({ method: 'tools/list', params: {} });
  const syncCall = await mcpCall({ method: 'tools/call', params: { name: 'search', arguments: { query: 'Invented' } } });
  const none = await get(null);
  const browser = await get(snap.secret, '', { origin: base });
  const demoted = await mint(admin2, 'snapshot');
  await db.query(`update platform.app_user set access = 'gp' where id = $1`, [admin2.id]);
  const afterDemotion = await get(demoted.secret);
  const revokedToken = await mint(juan, 'snapshot');
  await revokeMcpToken(juan, revokedToken.token.tokenId, db);
  const afterRevoke = await get(revokedToken.secret);
  const pushAudit = await auditOf(push.token.tokenId), demotedAudit = await auditOf(demoted.token.tokenId);
  check('SYNC scope: a push token cannot snapshot, a snapshot token cannot push, an MCP token neither, and a sync token lists and calls no MCP tool',
    pushOnSnap.status === 403 && snapOnPush.status === 403 && mcpOnSnap.status === 403
    && Array.isArray(syncList.result?.tools) && syncList.result.tools.length === 0 && syncCall.result?.isError === true
    && pushAudit.some((a) => a.action === 'mcp.call' && a.detail.via === 'sync' && a.detail.tool === 'sync_snapshot' && a.detail.outcome === 'refused' && a.detail.reason === 'scope'),
    `statuses ${[pushOnSnap, snapOnPush, mcpOnSnap].map((r) => r.status).join(', ')}; on /api/mcp ${syncList.result?.tools?.length ?? '?'} tools listed, search ${syncCall.result?.isError ? 'refused' : 'answered'}; refusals audited`);
  check('SYNC scope: no token, a browser Origin, a revoked token and an owner no longer Admin are refused, each refusal of a known token audited',
    none.status === 401 && browser.status === 403 && afterDemotion.status === 403 && afterRevoke.status === 401
    && demotedAudit.some((a) => a.action === 'mcp.call' && a.detail.outcome === 'refused' && a.detail.reason === 'role')
    && (await auditOf(revokedToken.token.tokenId)).some((a) => a.action === 'mcp.refused' && a.detail.reason === 'revoked' && a.detail.via === 'sync'),
    `statuses ${[none, browser, afterDemotion, afterRevoke].map((r) => r.status).join(', ')}`);

  // ── Push: refused with every reason, nothing written ─────────────────────────────────────
  const demoEnrich = join(process.cwd(), config.data.root, 'enrich');
  const inboxBefore = await readdir(join(demoEnrich, 'inbox')).catch(() => [] as string[]);
  const noSource = finding('sync-bad', '2026-09-30'); (noSource.facts[0]!.source as { url: string }).url = 'not a url';
  const dakotaSource = finding('sync-dakota', '2026-09-30', { facts: [{ field: 'aum', value: '$2B', source: { url: 'https://dakota.com/profile/invented', kind: 'database', title: 'Dakota Marketplace' }, confidence: 'high' }] });
  const dakotaCited = finding('sync-cites', '2026-09-30', { profile: { summary: `Per Dakota, an allocator ${WORD}.`, investorType: 'fo_principal' } });
  const strategyCites = { key: 'sync-strat', name: 'Invented', scores: { capacity: { band: 'unknown', basis: 'Dakota shows $40M in assets' } } };
  const invalidJson = await post(push.secret, '{"workflow": ');
  const bad = await post(push.secret, { workflow: 'W1', files: [
    { path: 'raw/sync-good.json', content: finding('sync-good', '2026-09-30') },
    { path: 'raw/sync-bad.json', content: noSource }, { path: 'raw/sync-dakota.json', content: dakotaSource }, { path: 'raw/sync-cites.json', content: dakotaCited },
    { path: 'strategy/sync-strat.json', content: {} }, { path: '../escape.json', content: {} }] });
  const badBody = await bad.json() as { ok: boolean; rejected: Array<{ path: string; problems: string[] }> };
  const w5 = await (await post(push.secret, { workflow: 'W5', files: [{ path: 'strategy/sync-strat.json', content: strategyCites }] })).json() as typeof badBody;
  const by = (p: string) => badBody.rejected?.find((r) => r.path === p)?.problems ?? [];
  const inboxAfter = await readdir(join(demoEnrich, 'inbox')).catch(() => [] as string[]);
  const statesPass = dakotaClaims(finding('x', '2026-01-01')).length === 0 && dakotaClaims({ source: { url: 'https://www.nd.gov/north-dakota' }, note: 'South Dakota and Dakota Capital' }).length === 0;
  check('SYNC push: refused with every reason by file — the importer\'s validators, paths, and any claim sourced from or citing Dakota — and nothing written',
    invalidJson.status === 400 && bad.status === 422 && badBody.ok === false && !by('raw/sync-good.json').length
    && by('raw/sync-bad.json').some((p) => p.includes('source URL'))
    && by('raw/sync-dakota.json').some((p) => p.includes('the source is Dakota')) && by('raw/sync-cites.json').some((p) => p.includes('cites Dakota'))
    && by('strategy/sync-strat.json').length > 0 && by('../escape.json').length > 0
    && w5.rejected?.some((r) => r.problems.some((p) => p.includes('scores.capacity.basis') && p.includes('Dakota'))) === true
    && statesPass && inboxBefore.length === inboxAfter.length
    && !(await stat(join(demoEnrich, 'raw', 'sync-good.json')).catch(() => null)),
    `${badBody.rejected?.length ?? 0} files refused in the W1 push; the W5 Dakota citation refused; North and South Dakota pass`);

  // ── Push: accepted, kept, recorded, imported once; idempotent ─────────────────────────────
  const root = await mkdtemp(join(tmpdir(), 'plcos-sync-props-'));
  const queued: string[] = [];
  const queue = async (_d: unknown, actor: string) => { queued.push(actor); return { id: '00000000-0000-4000-8000-0000000000a1', status: 'queued' }; };
  const accept = async (secret: string, body: unknown) => {
    const guard = await syncGuard(pushReq(secret, body), 'push');
    if ('response' in guard) return { status: guard.response.status, body: await guard.response.json() as Record<string, any> };
    return acceptPush(guard.caller, pushReq(secret, body), { root, db, queue }) as Promise<{ status: number; body: Record<string, any> }>;
  };
  try {
    const parent = '11111111-2222-4333-8444-555555555555';
    const w1 = { workflow: 'W1', files: [{ path: 'raw/sync-a.json', content: finding('sync-a', '2026-09-30') }, { path: 'raw/sync-b.json', content: finding('sync-b', '2026-09-30') }],
      run: { id: parent, source: 'claude-code', agent: 'lp-researcher' } };
    const first = await accept(push.secret, w1);
    const again = await accept(push.secret, { ...w1, run: { id: parent, agent: 'another launch' } });
    const runId = first.body.runId as string;
    const runs = (await readRuns({ root })).runs;
    const r = runs.find((x) => x.runId === runId);
    const receipt = JSON.parse(await readFile(join(root, 'enrich', 'inbox', runId, 'receipt.json'), 'utf8').catch(() => '{}'));
    const published = JSON.parse(await readFile(join(root, 'enrich', 'raw', 'sync-a.json'), 'utf8').catch(() => '{}'));
    const row = await db.one<{ run_id: string; job_id: string }>('select run_id::text, job_id::text from platform.sync_push where content_hash = $1', [bundleHash(w1 as never)]);
    check('SYNC push: an accepted push is kept under enrich/inbox/<run>/, published, recorded as a ledger run, and queues the findings import as its owner',
      first.status === 201 && first.body.files?.length === 2 && receipt.contentHash === first.body.contentHash && published.key === 'sync-a'
      && r?.outcome === 'succeeded' && r.start?.operation === 'push' && r.start.parentRunId === parent && r.start.workflow === 'W1' && r.finish?.counts.written === 2
      && queued.length === 1 && queued[0] === gp.id && row?.run_id === runId && row.job_id === '00000000-0000-4000-8000-0000000000a1',
      `run ${r?.outcome}, ${first.body.files?.length} files, import queued ${queued.length}×`);
    const inboxes = await readdir(join(root, 'enrich', 'inbox'));
    check('SYNC push: the same content again is a duplicate — the first run answered, nothing written, no second run or import',
      again.status === 200 && again.body.duplicate === true && again.body.runId === runId && queued.length === 1
      && (await readRuns({ root })).runs.length === runs.length && inboxes.length === 1,
      `second push ${again.status}, ${inboxes.length} inbox folder, ${(await readRuns({ root })).runs.length} ledger run`);

    // Older over newer is refused; a dated correction replaces, keeping the replaced copy.
    const older = await accept(push.secret, { workflow: 'W1', files: [{ path: 'raw/sync-a.json', content: finding('sync-a', '2026-09-01') }] });
    const sameDate = await accept(push.secret, { workflow: 'W1', files: [{ path: 'raw/sync-a.json', content: finding('sync-a', '2026-09-30', { name: 'Invented other' }) }] });
    const corrected = finding('sync-a', '2026-09-30', { researched: { at: '2026-09-30', by: 'props', workflow: 'W1', version: '1.50', corrected: [{ at: '2026-10-02', by: 'props', what: 'invented' }] } });
    const review = (facts: number) => [{ key: 'sync-a', identity: 'holds', identityNote: '', facts: Array.from({ length: facts }, (_, i) => ({ i, grade: 'supported', note: 'invented' })),
      counts: { supported: facts, partly: 0, notSupported: 0, someoneElse: 0, unavailable: 0 } }];
    const wrongCount = await accept(push.secret, { workflow: 'W1c', files: [{ path: 'fact-review-91a.jsonl', content: review(2) }, { path: 'raw/sync-a.json', content: corrected }] });
    const w1c = await accept(push.secret, { workflow: 'W1c', files: [{ path: 'fact-review-91a.jsonl', content: review(1) }, { path: 'raw/sync-a.json', content: corrected }] });
    const replacedCopy = await readFile(join(root, 'enrich', 'inbox', String(w1c.body.runId), 'replaced', 'raw', 'sync-a.json'), 'utf8').catch(() => '');
    const reviewFile = await readFile(join(root, 'enrich', 'fact-review-91a.jsonl'), 'utf8').catch(() => '');
    check('SYNC push: an older finding never replaces a newer one; a W1c review is graded against the server\'s finding; a dated correction replaces and keeps the old copy',
      older.status === 422 && String(older.body.rejected?.[0]?.problems).includes('older than the server') && sameDate.status === 422
      && wrongCount.status === 422 && String(wrongCount.body.rejected?.[0]?.problems).includes('against the server')
      && w1c.status === 201 && w1c.body.replaced === 1 && JSON.parse(replacedCopy || '{}').researched?.corrected === undefined
      && reviewFile.trim().split('\n').length === 1 && queued.length === 2,
      `older ${older.status}, same date ${sameDate.status}, bad review ${wrongCount.status}, W1c ${w1c.status} replacing ${w1c.body.replaced}`);
    const audits = await auditOf(push.token.tokenId);
    const calls = audits.filter((a) => a.action === 'mcp.call' && a.detail.tool === 'sync_push');
    const outcomes = calls.map((a) => a.detail.outcome);
    check('SYNC audit: every push is an mcp.call row (via sync, the shape of MCP and outreach calls) with its outcome, counts and hash, and no word of a file',
      ['invalid', 'ok'].every((o) => outcomes.includes(o)) && calls.some((a) => a.detail.duplicate === true)
      && calls.every((a) => a.detail.via === 'sync' && a.detail.risk === 'write-guarded' && a.detail.scopes?.[0] === SYNC_PUSH && typeof a.detail.ms === 'number')
      && calls.some((a) => a.detail.outcome === 'invalid' && a.detail.dakota >= 2)
      && calls.some((a) => a.detail.outcome === 'ok' && /^[0-9a-f]{64}$/.test(a.detail.hash) && a.detail.runId === runId)
      && !JSON.stringify(audits).includes(WORD) && !JSON.stringify(audits).includes('Invented page') && !JSON.stringify(audits).includes(push.secret),
      `${calls.length} calls: ${[...new Set(outcomes)].join(', ')}, one a duplicate`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  // ── Snapshot: where it refuses, one at a time, and the files it carries ──────────────────
  const unflagged = await get(snap.secret);
  process.env.SYNC_DEMO_SNAPSHOT = '1';
  const g = globalThis as typeof globalThis & { __syncSnapshotBusy?: boolean };
  g.__syncSnapshotBusy = true;
  const busy = db.kind === 'postgres' ? await get(snap.secret) : null;
  g.__syncSnapshotBusy = false;
  const pglite = db.kind === 'pglite' ? await get(snap.secret) : null;
  const fixture = await mkdtemp(join(tmpdir(), 'plcos-sync-files-'));
  try {
    const put = async (p: string) => { await mkdir(join(fixture, p, '..'), { recursive: true }); await writeFile(join(fixture, p), 'invented'); };
    const keep = ['enrich/raw/a.json', 'enrich/inbox/r/receipt.json', 'issues/0001.md', 'workflows/runs.jsonl', 'notes.txt'];
    const drop = ['postgres/PG_VERSION', 'database/x', 'dakota/raw/x.json', 'logs/a.log', 'rehearsal/x', 'backups/x', 'cloud-copy/x', 'database.lock', 'postgres.url', '.preview-copy',
      'enrich/research-set.jsonl', 'enrich/candidates.jsonl', 'enrich/team.json', 'enrich/triage.jsonl', 'enrich/identity-review.jsonl', 'enrich/lp-unit-review.jsonl', '.real-copy-1/x', 'enrich/.real-copy-2'];
    for (const p of [...keep, ...drop]) await put(p);
    const carried = await filesToCarry(fixture);
    const script = await readFile('scripts/cutover-files.sh', 'utf8');
    const list = (name: string) => new RegExp(`^${name}=\\(([^)]*)\\)`, 'm').exec(script)?.[1]?.trim().split(/\s+/) ?? [];
    const same = (a: readonly string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
    const caller = { token: snap.token, user: juan };
    const tar = await snapshotResponse(caller, true, { root: fixture });
    const archive = join(fixture, '..', `${fixture.split('/').pop()}.tgz`);
    await writeFile(archive, Buffer.from(await tar.arrayBuffer()));
    const listed = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).sort();
    await rm(archive, { force: true });
    check('SYNC snapshot: refused on an unflagged demo and on PGlite, 409 while one streams; the files archive carries what cutover carries, by cutover-files.sh\'s own lists',
      unflagged.status === 403 && (db.kind === 'postgres' ? busy?.status === 409 : pglite?.status === 501)
      && same(EXCLUDE_DIRS, list('EXCLUDE_DIRS')) && same(EXCLUDE_FILES, list('EXCLUDE_FILES')) && same(EXPORTS, list('EXPORTS'))
      && carried.join() === [...keep].sort().join() && tar.status === 200 && tar.headers.get('x-snapshot-files') === String(keep.length) && listed.join() === [...keep].sort().join(),
      `unflagged demo ${unflagged.status}; ${db.kind === 'postgres' ? `busy ${busy?.status}` : `PGlite ${pglite?.status}`}; ${listed.length} of ${keep.length + drop.length} fixture files in the archive`);

    if (db.kind === 'postgres') await roundTrip(check, db, GET, snap.secret, fixture);
  } finally {
    delete process.env.SYNC_DEMO_SNAPSHOT;
    await rm(fixture, { recursive: true, force: true });
  }
  await scriptPush(check, db, push.secret);
  await db.query(`update platform.app_user set active = false where handle in ('sync-gp', 'sync-viewer', 'sync-admin')`);
  for (const t of [snap, push, adminPush, demoted]) await revokeMcpToken(t === push ? gp : t === demoted ? admin2 : juan, t.token.tokenId, db);
}

/**
 * Dump → restore into a scratch cluster on a free port → every table's row count matches, through the
 * real script (scripts/cloud-pull.sh init and pull --keep) against the real route, served on loopback.
 */
async function roundTrip(check: Check, db: Db, GET: (r: Request) => Promise<Response>, secret: string, files: string) {
  const scratch = await mkdtemp(join(tmpdir(), 'plcos-sync-pull-'));
  const port = await freePort();
  const copyPw = `invented-${Math.random().toString(36).slice(2)}`;
  let server: Server | null = null;
  const dir = join(scratch, 'cloud-copy');
  try {
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const request = new Request(`http://127.0.0.1${url.pathname}${url.search}`, { headers: Object.entries(req.headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])) as [string, string][] });
      let response: Response;
      if (url.searchParams.get('files') === '1') {
        const guard = await syncGuard(request, 'snapshot');
        response = 'response' in guard ? guard.response : await snapshotResponse(guard.caller, true, { root: files });
      } else response = await GET(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      try { if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk); res.end(); } catch { res.destroy(); }
    });
    const appPort = await new Promise<number>((resolve) => server!.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port)));
    const tables = await db.query<{ t: string }>(`select format('%I.%I', n.nspname, c.relname) t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and n.nspname <> 'information_schema' and n.nspname !~ '^pg_' order by 1`);
    const counts = async (q: (sql: string) => Promise<Array<{ n: string }>>) => {
      const out: Record<string, string> = {};
      for (const { t } of tables) out[t] = (await q(`select count(*)::text n from ${t}`))[0]!.n;
      return out;
    };
    const before = await counts((sql) => db.query<{ n: string }>(sql));
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: scratch, PG_BIN, COPY_PGPASSWORD: copyPw, CLOUD_SNAPSHOT_TOKEN: secret,
      CLOUD_APP_URL: `http://127.0.0.1:${appPort}`, PLCOS_BACKUPS: join(scratch, 'backups'), CLOUD_KEEP_PASSPHRASE_FILE: join(scratch, 'pass'), MAX_GB: '1' } as unknown as NodeJS.ProcessEnv;
    await writeFile(join(scratch, 'pass'), 'invented passphrase for the props', { mode: 0o600 });
    const to = `postgres://plcos@127.0.0.1:${port}/plcos_copy`;
    const init = await run('bash', ['scripts/cloud-pull.sh', 'init', '--to', to, '--dir', dir], env);
    const pull = await run('bash', ['scripts/cloud-pull.sh', 'pull', '--to', to, '--dir', dir, '--keep'], env);
    let after: Record<string, string> = {};
    if (pull.code === 0) {
      const copy = await openPostgres(`postgres://plcos:${encodeURIComponent(copyPw)}@127.0.0.1:${port}/plcos_copy`);
      try { after = await counts((sql) => copy.query<{ n: string }>(sql)); } finally { await copy.close(); }
    }
    const differ = tables.map(({ t }) => t).filter((t) => before[t] !== after[t]);
    const backups = await readdir(join(scratch, 'backups')).catch(() => [] as string[]);
    const kept = backups.find((f) => /^plcos-cloud-\d{8}T\d{4}Z-daily\.tar\.gz\.gpg$/.test(f));
    const opened = kept ? spawnSync('bash', ['-c', `gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$1" --decrypt "$2" | tar -tz`, '_', join(scratch, 'pass'), join(scratch, 'backups', kept)], { encoding: 'utf8', env: { ...process.env, HOME: scratch } }).stdout : '';
    const leaked = (init.out + pull.out).includes(secret) || (init.out + pull.out).includes(copyPw);
    check('SYNC snapshot round trip: cloud-pull.sh pulls the route\'s pg_dump into a scratch cluster on a free port and every table\'s row count matches; --keep leaves an encrypted copy that opens',
      init.code === 0 && pull.code === 0 && tables.length > 50 && differ.length === 0 && Boolean(kept)
      && opened.includes('cloud/database.dump') && opened.includes('cloud/files.tar.gz') && !leaked,
      init.code !== 0 || pull.code !== 0 ? `init ${init.code}, pull ${pull.code}: ${(init.out + pull.out).split('\n').filter((l) => l.includes('STOPPED') || l.includes('error')).slice(0, 3).join(' | ')}`
        : `${tables.length} tables, ${differ.length} differ${differ.length ? ` (${differ.slice(0, 5).join(', ')})` : ''}; kept ${kept ? 'and opened' : 'nothing'}; no secret in the output`);
  } finally {
    server?.close();
    spawnSync(`${PG_BIN}/pg_ctl`, ['-D', join(dir, 'postgres'), '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * scripts/cloud-push.sh end to end against the push route's own guard and service, served on loopback into a
 * scratch data root: a Dakota-sourced finding is refused on the Mac and never sent; a valid one is taken; the
 * same file again is answered as already taken; the token never reaches the output.
 */
async function scriptPush(check: Check, db: Db, secret: string) {
  const scratch = await mkdtemp(join(tmpdir(), 'plcos-sync-push-'));
  const root = join(scratch, 'server'), mac = join(scratch, 'mac', 'enrich', 'raw');
  let server: Server | null = null, requests = 0;
  try {
    await mkdir(root, { recursive: true }); await mkdir(mac, { recursive: true });
    await writeFile(join(mac, 'sync-script.json'), JSON.stringify(finding('sync-script', '2026-10-01')));
    await writeFile(join(mac, 'sync-script-dakota.json'), JSON.stringify(finding('sync-script-dakota', '2026-10-01', {
      facts: [{ field: 'check_size', value: '$5M', source: { url: 'https://invented.example/x', kind: 'database', title: 'Dakota Marketplace profile' }, confidence: 'high' }] })));
    server = createServer(async (req, res) => {
      requests++;
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const request = () => new Request(`http://127.0.0.1${req.url}`, { method: 'POST', body: Buffer.concat(chunks),
        headers: Object.entries(req.headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])) as [string, string][] });
      const guard = await syncGuard(request(), 'push');
      const out = 'response' in guard ? { status: guard.response.status, body: await guard.response.json() }
        : await acceptPush(guard.caller, request(), { root, db, queue: async () => ({ id: '00000000-0000-4000-8000-0000000000b2', status: 'queued' }) });
      res.writeHead(out.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(out.body));
    });
    const port = await new Promise<number>((resolve) => server!.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port)));
    const env = { PATH: process.env.PATH, HOME: scratch, CLOUD_PUSH_TOKEN: secret, CLOUD_APP_URL: `http://127.0.0.1:${port}` } as unknown as NodeJS.ProcessEnv;
    const dakota = await run('bash', ['scripts/cloud-push.sh', join(mac, 'sync-script-dakota.json')], env);
    const sentForDakota = requests;
    const first = await run('bash', ['scripts/cloud-push.sh', '--run', '11111111-2222-4333-8444-666666666666', join(mac, 'sync-script.json')], env);
    const again = await run('bash', ['scripts/cloud-push.sh', join(mac, 'sync-script.json')], env);
    const taken = await readFile(join(root, 'enrich', 'raw', 'sync-script.json'), 'utf8').catch(() => '');
    const all = dakota.out + first.out + again.out;
    check('SYNC cloud-push.sh: a Dakota-sourced finding is refused on the Mac and never sent; a valid one is taken and imported; the same file again is already taken',
      dakota.code === 1 && /nothing was sent/.test(dakota.out) && /Dakota/.test(dakota.out) && sentForDakota === 0
      && first.code === 0 && /taken: run [0-9a-f-]{36}, 1 files/.test(first.out) && /findings import/.test(first.out) && JSON.parse(taken || '{}').key === 'sync-script'
      && again.code === 0 && /already taken/.test(again.out) && requests === 2 && !all.includes(secret),
      `Dakota push exit ${dakota.code} with ${sentForDakota} requests; first exit ${first.code}; again exit ${again.code}; ${requests} requests in all; no token in the output`);
  } finally {
    server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
