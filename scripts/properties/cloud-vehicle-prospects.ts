/**
 * A new vehicle made on the cloud server and filled with researched prospects from the Mac (5 Oct 2026), on
 * invented data, the demo profile and scratch folders only. Never the live checkout or real data.
 *   - Settings → Vehicles: only an Admin adds a vehicle (the action's rule and the service both refuse Team and
 *     Viewer, and a refusal is audited); the slug is url-safe, unique and not a page's address; the exemption is
 *     chosen, never defaulted; one audit row says who made it; it sorts last and is listed at once, and the read
 *     revision the page caches key on moves;
 *   - the row is the init file's row: the same writer, the same columns; a reload without its slug leaves it
 *     alone and one with it updates it;
 *   - a prospects push: one bad line, an unknown vehicle or a vehicle the Team member may not change refuses the
 *     whole push with line numbers and writes nothing; an accepted one is written under a new run-specific name
 *     (never over a file) and queues Add prospects as the token's owner, whose pursuits they become; the import
 *     reads the pushed file at once while a hand-placed file younger than two minutes still waits, even when a
 *     job names it; the status endpoint answers the counts to the pusher alone; a running import refuses a push;
 *   - scripts/cloud-push.sh prospects and status end to end on loopback; scripts/prospects-check.ts --vehicle.
 */
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthorizationError } from '../../lib/authz';
import { authorizeAction } from '../../lib/authz/server';
import { readRevision } from '../../lib/build-cache';
import { readProspectFiles } from '../../lib/enrich/prospects';
import { PUSHED_PROSPECTS } from '../../lib/enrich/prospect-rows';
import { prospectsJob } from '../../lib/import-jobs/operations';
import { createImportJob, executeImportJob, failImportJob } from '../../lib/import-jobs/store';
import { applyVehicles, type VehicleInit } from '../../lib/real/init';
import { syncGuard } from '../../lib/sync/auth';
import { bundleHash, checkBundle } from '../../lib/sync/bundle';
import { acceptPush, placeNew, pushStatus, type QueueImport } from '../../lib/sync/push';
import { SYNC_PUSH } from '../../lib/sync/scopes';
import { checkNewVehicle, createMcpToken, createVehicle, listVehicles, revokeMcpToken, slugFromName, VehicleRefused, type AppUser } from '../../modules/platform';
import type { Check, Db } from './harness';

const ACTION = 'app/settings/vehicles/actions.ts#createVehicleAction' as const;
const COLUMNS = `kind::text, exemption, target_amount::text, phase, raise_opens_on::text, raise_closes_on::text, raise_window_note, aliases`;

const row = (key: string, vehicle: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  personKey: `props-cvp:${key}`, name: `Invented Cvp ${key}`, org: `Invented Cvp Org ${key}`, vehicle, status: 'sourcing',
  capacity: { band: '$500K–1M', basis: 'Invented fixture: estimated', guess: true }, reason: 'Invented fit for the props.',
  strategic: false, route: null, sources: ['Invented fixture only'], ...extra,
});
const file = (...lines: string[]) => lines.join('\n') + '\n';

const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv) => new Promise<{ code: number | null; out: string }>((resolve) => {
  const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  child.once('close', (code) => resolve({ code, out }));
});

export async function cloudVehicleProspectsProperties(check: Check, db: Db) {
  const user = async (handle: string, access: string, vehicles: string[] | null = null) => (await db.one<AppUser>(`insert into platform.app_user (handle, name, initials, role, email, access, vehicles)
    values ($1, $2, 'IC', 'Invented (props)', $3, $4::platform.access_role, $5::uuid[]) on conflict (handle) do update set active = true, access = excluded.access, vehicles = excluded.vehicles
    returning id::text, handle, name, initials, role, email, access::text, vehicles::text[], approves`, [handle, `Invented ${handle}`, `${handle}@example.invalid`, access, vehicles]))!;
  const admin = await user('cvp-admin', 'admin');
  const team = await user('cvp-team', 'team', []);
  const viewer = await user('cvp-viewer', 'viewer', []);

  // ── Settings → Vehicles: who may add one ──────────────────────────────────────────────────
  const refusedAction = async (u: AppUser) => {
    try { await authorizeAction(u, ACTION, [null, new FormData()], db); return false; } catch (e) { if (e instanceof AuthorizationError) return true; throw e; }
  };
  const refusedService = async (u: AppUser) => {
    try { await createVehicle(u, { name: 'Invented Refused SPV', slug: 'invented-refused-spv', kind: 'spv', exemption: '506(c)' }, db); return false; }
    catch (e) { return e instanceof VehicleRefused; }
  };
  const adminAllowed = !(await refusedAction(admin));
  const teamRefused = await refusedAction(team), viewerRefused = await refusedAction(viewer);
  const serviceRefused = (await refusedService(team)) && (await refusedService(viewer));
  const refusals = await db.query<{ actor_id: string }>(`select actor_id::text from platform.audit_log where action = 'authz.refused' and subject_id = $1`, [ACTION]);
  check('VEHICLE add: only an Admin — Team and Viewer are refused by the action\'s rule (each refusal audited) and by the service itself',
    adminAllowed && teamRefused && viewerRefused && serviceRefused && refusals.some((r) => r.actor_id === team.id)
    && !(await db.one(`select 1 from platform.vehicle where slug = 'invented-refused-spv'`)),
    `admin allowed ${adminAllowed}; team refused ${teamRefused}, viewer ${viewerRefused}; service refuses both ${serviceRefused}; ${refusals.length} refusals audited`);

  // ── Slug and fields ────────────────────────────────────────────────────────────────────────
  const problems = (over: Record<string, unknown>) => checkNewVehicle({ name: 'Invented Slug SPV', slug: 'invented-slug-spv', kind: 'spv', exemption: '506(c)', ...over } as never).problems;
  const before = await listVehicles();
  const revisionBefore = await readRevision(db);
  const made = await createVehicle(admin, { name: 'Invented Cloud SPV I', slug: 'invented-cloud-spv-i', kind: 'spv', exemption: '506(c)', target: '25M', opens: '2026-10-01', closes: '', aliases: 'Invented Cloud Co, ICC' }, db);
  const taken = await createVehicle(admin, { name: 'Invented Other', slug: 'invented-cloud-spv-i', kind: 'spv', exemption: '506(c)' }, db).then(() => false, (e) => e instanceof VehicleRefused);
  const sameName = await createVehicle(admin, { name: 'invented cloud spv i', slug: 'invented-cloud-spv-x', kind: 'spv', exemption: '506(c)' }, db).then(() => false, (e) => e instanceof VehicleRefused);
  const bad = {
    upper: problems({ slug: 'Invented-SPV' }).length > 0, space: problems({ slug: 'invented spv' }).length > 0, dash: problems({ slug: '-invented' }).length > 0,
    slash: problems({ slug: 'a/b' }).length > 0, page: problems({ slug: 'settings' }).length > 0, all: problems({ slug: 'all' }).length > 0,
    noExemption: problems({ exemption: '' }).some((p) => p.includes('never defaulted')), unknownActive: problems({ exemption: 'unknown' }).length > 0,
    kind: problems({ kind: 'trust' }).length > 0, target: problems({ target: '-5' }).length > 0, window: problems({ opens: '2026-10-02', closes: '2026-10-01' }).length > 0,
  };
  const slugOk = slugFromName('Invented Cloud SPV I') === 'invented-cloud-spv-i' && slugFromName('  Ünïcode — Fund 2 ') === 'unicode-fund-2' && problems({}).length === 0;
  check('VEHICLE slug and fields: derived from the name, url-safe, unique, not a page\'s address; the exemption is chosen, never defaulted, and "unknown" only historical',
    slugOk && taken && sameName && Object.values(bad).every(Boolean),
    `slug from name ${slugOk}; taken slug refused ${taken}, same name ${sameName}; refused: ${Object.entries(bad).filter(([, v]) => v).map(([k]) => k).join(', ')}`);

  const after = await listVehicles();
  const listed = after.find((v) => v.slug === made.slug);
  const audit = await db.one<{ actor_id: string; detail: Record<string, unknown> }>(`select actor_id::text, detail from platform.audit_log where action = 'vehicle.created' and subject_type = 'vehicle' and subject_id = $1`, [made.id]);
  const stored = await db.one<{ target_amount: string; aliases: string[]; raise_opens_on: string; raise_closes_on: string | null; phase: string }>(
    `select target_amount::text, aliases, raise_opens_on::text, raise_closes_on::text, phase from platform.vehicle where id = $1`, [made.id]);
  check('VEHICLE created: one audit row (subject vehicle) names the Admin; it sorts after the last vehicle, is listed at once, and the read revision the page caches key on moves',
    audit?.actor_id === admin.id && audit.detail.slug === made.slug && audit.detail.exemption === '506(c)'
    && listed !== undefined && listed.sortOrder === Math.max(...before.map((v) => v.sortOrder)) + 1 && after[after.length - 1]?.slug === made.slug
    && listed.phase === 'active' && Number(stored?.target_amount) === 25_000_000 && stored?.aliases.join('|') === 'Invented Cloud Co|ICC'
    && stored.raise_opens_on === '2026-10-01' && stored.raise_closes_on === null && (await readRevision(db)) !== revisionBefore,
    `audit by ${audit?.actor_id === admin.id ? 'the admin' : audit?.actor_id}; sort ${listed?.sortOrder} after ${Math.max(...before.map((v) => v.sortOrder))}; ${after.length - before.length} more listed`);

  // ── The init file's row; reload compatibility ─────────────────────────────────────────────
  const asInit = (slug: string, name: string): VehicleInit => ({ slug, name, kind: 'spv', exemption: '506(c)', phase: 'active', target: 25_000_000, firstClose: null,
    affinityLists: [], raise: { opens: '2026-10-01', closes: null, note: null }, aliases: ['Invented Cloud Co', 'ICC'] });
  await applyVehicles(db, [asInit('invented-init-twin', 'Invented Init Twin')]);
  const cols = async (slug: string) => JSON.stringify(await db.one(`select ${COLUMNS} from platform.vehicle where slug = $1`, [slug]));
  const same = (await cols(made.slug)) === (await cols('invented-init-twin'));
  const full = async () => JSON.stringify(await db.one('select * from platform.vehicle where id = $1', [made.id]));
  const untouchedBefore = await full();
  await applyVehicles(db, [asInit('invented-init-twin', 'Invented Init Twin')]);
  const untouched = (await full()) === untouchedBefore;
  await applyVehicles(db, [asInit('invented-init-twin', 'Invented Init Twin'), { ...asInit(made.slug, 'Invented Cloud SPV I (renamed by init)'), exemption: '506(b)' }]);
  const updated = await db.one<{ id: string; name: string; exemption: string }>('select id::text, name, exemption from platform.vehicle where slug = $1', [made.slug]);
  await applyVehicles(db, [asInit(made.slug, 'Invented Cloud SPV I')]);
  check('VEHICLE and the init file: the app writes the row the file writes; a reload without its slug leaves it alone, one with it updates it in place',
    same && untouched && updated?.id === made.id && updated.name.includes('renamed by init') && updated.exemption === '506(b)',
    `same columns ${same}; untouched by a reload without it ${untouched}; updated in place by one with it ${updated?.id === made.id && updated?.exemption === '506(b)'}`);
  await db.query(`delete from platform.vehicle where slug = 'invented-init-twin'`);

  await pushProperties(check, db, admin, team, made);
  await db.query(`update platform.app_user set active = false where handle in ('cvp-admin', 'cvp-team', 'cvp-viewer')`);
}

async function pushProperties(check: Check, db: Db, admin: AppUser, team: AppUser, made: { id: string; slug: string }) {
  await db.query(`update platform.app_user set vehicles = $2::uuid[] where id = $1`, [team.id, [made.id]]);
  const teamNow = { ...team, vehicles: [made.id] };
  const mint = async (owner: AppUser) => createMcpToken(owner, { label: 'props cvp push', tools: [SYNC_PUSH], vehicles: null, callsPerDay: 200, days: 30 }, db);
  const teamToken = await mint(teamNow), adminToken = await mint(admin);
  const base = 'http://localhost:3121';
  const req = (secret: string, body: unknown) => new Request(`${base}/api/sync/push`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const root = await mkdtemp(join(tmpdir(), 'plcos-cvp-props-'));
  const dir = join(root, 'enrich', 'prospects');
  const queued: Array<{ actor: string; kind: string; input: Record<string, unknown>; id: string }> = [];
  // The real job row, run the real way (prospectsJob, executeImportJob) on the scratch folder.
  const queue: QueueImport = async (d, actor, kind, input) => {
    const job = await createImportJob(d, kind, actor, input);
    queued.push({ actor, kind, input, id: job.id });
    if (kind === 'prospects') await executeImportJob(d, job.id, (j, progress) => prospectsJob(d, j.actor, j.input, progress, dir));
    return { id: job.id, status: 'queued' };
  };
  const accept = async (secret: string, body: unknown) => {
    const guard = await syncGuard(req(secret, body), 'push');
    if ('response' in guard) return { status: guard.response.status, body: await guard.response.json() as Record<string, any> };
    return acceptPush(guard.caller, req(secret, body), { root, db, queue }) as Promise<{ status: number; body: Record<string, any> }>;
  };
  const listing = async () => [...await readdir(dir).catch(() => [] as string[]), ...await readdir(join(root, 'enrich', 'inbox')).catch(() => [] as string[])].sort().join();
  try {
    // ── Refused whole, by line, nothing written ──────────────────────────────────────────────
    const empty = await listing();
    const badLine = { workflow: 'prospects', files: [{ path: 'prospects/cvp-bad.jsonl', content: file(row('a', made.slug), row('b', made.slug, { strategic: 'yes' }), row('c', made.slug)) }] };
    const unknown = { workflow: 'prospects', files: [{ path: 'prospects/cvp-unknown.jsonl', content: file(row('a', made.slug), row('d', 'invented-no-such-vehicle')) }] };
    const outside = { workflow: 'prospects', files: [{ path: 'prospects/cvp-outside.jsonl', content: file(row('e', 'neurotech')) }] };
    const r1 = await accept(teamToken.secret, badLine), r2 = await accept(teamToken.secret, unknown), r3 = await accept(teamToken.secret, outside);
    const said = (r: { body: Record<string, any> }) => JSON.stringify(r.body.rejected ?? []);
    const stillEmpty = (await listing()) === empty && queued.length === 0
      && !(await db.one('select 1 from platform.sync_push where content_hash = any($1)', [[badLine, unknown, outside].map((b) => bundleHash(b as never))]));
    const macSide = checkBundle(badLine, 10).rejections;
    check('PROSPECTS push refused whole: one bad line, an unknown vehicle, or a vehicle the Team member may not change — line-numbered, nothing written, nothing queued',
      r1.status === 422 && said(r1).includes('line 2:') && !said(r1).includes('line 1:') && !said(r1).includes('line 3:')
      && r2.status === 422 && said(r2).includes('line 2: Unknown vehicle slug') && r3.status === 422 && said(r3).includes('line 1: vehicle \\"neurotech\\" is not one you can change')
      && JSON.stringify(macSide).includes('line 2:') && stillEmpty,
      `statuses ${r1.status}, ${r2.status}, ${r3.status}; the Mac's own check names line 2 too; nothing written ${stillEmpty}`);

    // ── Accepted: a new file, queued as the token's owner, imported at once ──────────────────
    await mkdir(dir, { recursive: true });
    // Hand-placed a moment ago (as a person or an agent still writing would leave it): it must wait.
    await writeFile(join(dir, 'hand-placed.jsonl'), file(row('h', made.slug)));
    const good = { workflow: 'prospects', files: [{ path: 'prospects/cvp-good.jsonl', content: file(row('f', made.slug), row('g', made.slug)) }] };
    const ok = await accept(teamToken.secret, good);
    const published = String(ok.body.published?.[0] ?? '');
    const name = published.slice('prospects/'.length);
    const job = queued[0];
    const pursuits = await db.query<{ owner: string; name: string }>(`select p.owner_id::text owner, e.display_name name from strategy.pursuit p join identity.entity e on e.entity_id = p.entity_id
      where p.vehicle_id = $1 and p.source = 'prospects' order by e.display_name`, [made.id]);
    const result = await db.one<{ status: string; result: Record<string, any> }>('select status, result from platform.import_job where id = $1', [job?.id]);
    check('PROSPECTS push accepted: written under a new run-specific name and queued as Add prospects for the token\'s owner, whose pursuits they become',
      ok.status === 201 && PUSHED_PROSPECTS.test(name) && name.endsWith('-cvp-good.jsonl') && (await readFile(join(root, 'enrich', published), 'utf8')) === good.files[0]!.content
      && queued.length === 1 && job?.kind === 'prospects' && job.actor === team.id && JSON.stringify(job.input.settled) === JSON.stringify([name])
      && ok.body.import?.jobId === job.id && result?.status === 'completed' && result.result.added === 2
      && pursuits.length === 2 && pursuits.every((p) => p.owner === team.id) && pursuits.map((p) => p.name).join() === 'Invented Cvp f,Invented Cvp g',
      `${ok.status}, written as ${name}; job ${job?.kind} as ${job?.actor === team.id ? 'the token\'s owner' : job?.actor}, ${result?.status}, ${result?.result?.added} added; ${pursuits.length} pursuits theirs`);

    // ── The two-minute guard, intact for hand-placed files ───────────────────────────────────
    const fresh = Date.now() - (await stat(join(dir, name))).mtimeMs < 120_000;
    const plain = await readProspectFiles(dir);
    const forged = await prospectsJob(db, team.id, { settled: ['hand-placed.jsonl', '../escape.jsonl'] }, async () => undefined, dir);
    const handAdded = await db.one(`select 1 from strategy.pursuit p join identity.entity e on e.entity_id = p.entity_id where e.display_name = 'Invented Cvp h'`);
    check('PROSPECTS settle guard: the pushed file is read at once though new; a hand-placed file under two minutes old still waits, even when a job names it',
      fresh && result?.result.inProgress === 1 && plain.find((f) => f.file === name)?.inProgress === true && plain.find((f) => f.file === 'hand-placed.jsonl')?.inProgress === true
      && forged.inProgress === 2 && forged.added === 0 && !handAdded,
      `pushed file ${fresh ? 'fresh' : 'old'} yet imported; without the push's list both wait; a forged list leaves ${forged.inProgress} waiting, ${forged.added} added`);

    // ── No overwrite ─────────────────────────────────────────────────────────────────────────
    const again = await accept(teamToken.secret, good);
    const second = await accept(teamToken.secret, { workflow: 'prospects', files: [{ path: 'prospects/cvp-good.jsonl', content: file(row('f', made.slug)) }] });
    const firstStill = (await readFile(join(root, 'enrich', published), 'utf8')) === good.files[0]!.content;
    await writeFile(join(dir, 'occupied.jsonl'), 'invented original\n');
    const clobber = await placeNew(await realpath(join(root, 'enrich')), 'prospects/occupied.jsonl', 'invented replacement\n', 'props').then(() => false, (e: NodeJS.ErrnoException) => e.code === 'EEXIST');
    const occupied = await readFile(join(dir, 'occupied.jsonl'), 'utf8');
    const leftovers = (await readdir(dir)).filter((f) => f.endsWith('.tmp'));
    check('PROSPECTS no overwrite: the same file again is a duplicate; a new push of the same name gets its own file; nothing replaces a file already there',
      again.status === 200 && again.body.duplicate === true && second.status === 201 && second.body.published?.[0] !== published && firstStill
      && clobber && occupied === 'invented original\n' && leftovers.length === 0,
      `again ${again.status}${again.body.duplicate ? ' (duplicate)' : ''}; second ${second.status} as its own file; a write over an existing file refused ${clobber}`);

    // ── Status, to the pusher alone ──────────────────────────────────────────────────────────
    const { GET } = await import('../../app/api/sync/push/route');
    const status = async (secret: string, id: string) => { const r = await GET(new Request(`${base}/api/sync/push?job=${id}`, { headers: { authorization: `Bearer ${secret}` } })); return { status: r.status, body: await r.json() as Record<string, any> }; };
    const mine = await status(teamToken.secret, job!.id), theirs = await status(adminToken.secret, job!.id), junk = await status(teamToken.secret, 'not-a-job');
    check('PROSPECTS status: GET ?job= answers the pusher the import\'s state and counts (added, existing, ambiguous) and their file\'s rows; another person gets 404',
      mine.status === 200 && mine.body.job?.status === 'completed' && mine.body.job.counts.added === 2 && typeof mine.body.job.counts.ambiguous === 'number'
      && typeof mine.body.job.counts.existing === 'number' && mine.body.job.pushed?.[0]?.won === 2 && !JSON.stringify(mine.body).includes('Invented Cvp')
      && theirs.status === 404 && junk.status === 400,
      `pusher ${mine.status} (${mine.body.job?.counts?.added} added), another person ${theirs.status}, a malformed id ${junk.status}`);

    // ── A running prospects import refuses a push, before anything is written ────────────────
    const running = await createImportJob(db, 'prospects', admin.id, { props: 'cvp' });
    const before = await listing();
    const busy = await accept(adminToken.secret, { workflow: 'prospects', files: [{ path: 'prospects/cvp-busy.jsonl', content: file(row('i', made.slug)) }] });
    const unchanged = (await listing()) === before;
    await failImportJob(db, running.id, 'props: released');
    check('PROSPECTS busy: while a prospects import runs, a push is refused (409) and nothing is written',
      busy.status === 409 && unchanged, `${busy.status}; nothing written ${unchanged}`);

    await scriptPush(check, db, teamToken.secret, made.slug);
  } finally {
    await revokeMcpToken(teamNow, teamToken.token.tokenId, db).catch(() => undefined);
    await revokeMcpToken(admin, adminToken.token.tokenId, db).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}

/** scripts/cloud-push.sh prospects and status, and scripts/prospects-check.ts --vehicle, on loopback and scratch files. */
async function scriptPush(check: Check, db: Db, secret: string, slug: string) {
  const scratch = await mkdtemp(join(tmpdir(), 'plcos-cvp-script-'));
  const root = join(scratch, 'server');
  let server: Server | null = null;
  try {
    await mkdir(root, { recursive: true });
    const mac = join(scratch, 'mac.jsonl');
    await writeFile(mac, file(row('s1', slug), row('s2', slug)));
    const scriptQueue: QueueImport = async (d, actor, kind, input) => {
      const job = await createImportJob(d, kind, actor, input);
      await executeImportJob(d, job.id, (j, progress) => prospectsJob(d, j.actor, j.input, progress, join(root, 'enrich', 'prospects')));
      return { id: job.id, status: 'queued' };
    };
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers = Object.entries(req.headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])) as [string, string][];
      const request = () => new Request(`http://127.0.0.1${req.url}`, req.method === 'POST' ? { method: 'POST', body: Buffer.concat(chunks), headers } : { headers });
      const guard = await syncGuard(request(), 'push');
      const out = 'response' in guard ? { status: guard.response.status, body: await guard.response.json() }
        : req.method === 'GET' ? await pushStatus(guard.caller, request(), { db }) : await acceptPush(guard.caller, request(), { root, db, queue: scriptQueue });
      res.writeHead(out.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(out.body));
    });
    const port = await new Promise<number>((resolve) => server!.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port)));
    const env = { PATH: process.env.PATH, HOME: scratch, CLOUD_PUSH_TOKEN: secret, CLOUD_APP_URL: `http://127.0.0.1:${port}` } as unknown as NodeJS.ProcessEnv;
    const pushed = await run('bash', ['scripts/cloud-push.sh', 'prospects', mac], env);
    const jobId = /prospects import ([0-9a-f-]{36})/.exec(pushed.out)?.[1] ?? '';
    const asked = await run('bash', ['scripts/cloud-push.sh', 'status', jobId], env);
    await writeFile(mac, file(row('s3', slug), row('s4', slug, { capacity: null })));
    const refusedHere = await run('bash', ['scripts/cloud-push.sh', 'prospects', mac], env);
    check('PROSPECTS cloud-push.sh: `prospects <file>` is checked on the Mac, taken, imported, and its counts printed; `status <job>` asks again; a bad line never leaves the Mac',
      pushed.code === 0 && /taken: run [0-9a-f-]{36}, 1 files/.test(pushed.out) && /written as prospects\/\d{4}-\d{2}-\d{2}-push-[0-9a-f]{8}-mac\.jsonl/.test(pushed.out)
      && /completed: 2 added/.test(pushed.out) && asked.code === 0 && /completed: 2 added/.test(asked.out)
      && refusedHere.code === 1 && /nothing was sent/.test(refusedHere.out) && /line 2:/.test(refusedHere.out) && !(pushed.out + asked.out + refusedHere.out).includes(secret),
      `push exit ${pushed.code}, status exit ${asked.code}, a bad line exit ${refusedHere.code}; no token in the output`);

    // The Mac's check, for a vehicle the cloud has and this Mac does not yet.
    const local = join(scratch, 'local.jsonl');
    await writeFile(local, file(row('l1', 'invented-brand-new-spv')));
    const env2 = { ...process.env, DATA_PROFILE: 'demo' } as NodeJS.ProcessEnv;
    const flagged = await run(process.execPath, ['--import', 'tsx', 'scripts/prospects-check.ts', '--vehicle', 'invented-brand-new-spv', local], env2);
    const unflagged = await run(process.execPath, ['--import', 'tsx', 'scripts/prospects-check.ts', local], env2);
    await writeFile(local, file(row('l1', 'invented-brand-new-spv', { sources: [] })));
    const badRow = await run(process.execPath, ['--import', 'tsx', 'scripts/prospects-check.ts', '--vehicle', 'invented-brand-new-spv', local], env2);
    check('PROSPECTS prospects-check.ts --vehicle: a slug given is treated as known, with a note; without it an unknown slug fails (or, with nothing to check against, says so); a bad row still fails',
      flagged.code === 0 && /note: treating "invented-brand-new-spv" as known vehicle/.test(flagged.out) && /1 valid, 0 invalid/.test(flagged.out)
      && ((unflagged.code === 1 && /Unknown vehicle slug/.test(unflagged.out)) || (unflagged.code === 0 && /not checked here/.test(unflagged.out)))
      && badRow.code === 1 && /line 1: sources/.test(badRow.out),
      `with --vehicle exit ${flagged.code}; without exit ${unflagged.code}; a bad row exit ${badRow.code}`);
  } finally {
    server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
