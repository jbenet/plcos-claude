/**
 * Linear, read-only (docs/24-linear.md), on the invented workspace in fixtures/linear/ only:
 *   - no mutation leaves the client, by any route the code offers;
 *   - the key is never logged, thrown, recorded or written;
 *   - cursor pagination and backoff on 429, RATELIMITED and a low hourly budget;
 *   - the replica translation: newer wins, an explicit null clears, an absent field is kept,
 *     a replay is a no-op, and a translated file that changes is refused.
 */
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../../lib/db';
import { assertReadOnly, httpsTransport, linearClient, LinearError, LinearRefused, LINEAR_ENDPOINT, type LinearTransport } from '../../lib/connectors/linear/client';
import { fixtureTransport, loadWorkspace, type Workspace } from '../../lib/connectors/linear/fixture';
import { linearKey, withoutLinearKey } from '../../lib/connectors/linear/key';
import { pullLinear } from '../../lib/connectors/linear/pull';
import { QUERIES, ENTITIES, opName } from '../../lib/connectors/linear/queries';
import { normalize, readReplicas, TABLE } from '../../lib/connectors/linear/replica';
import { rebuildLinear, syncLinear } from '../../lib/connectors/linear/sync';
import { linearOverview } from '../../lib/connectors/linear/view';
import { translateLinear } from '../../lib/connectors/linear/translate';
import type { Check } from './harness';

const KEY = 'lin_api_INVENTEDinventedINVENTED0123456789';
const limits = { minIntervalMs: 0, minRequestsLeft: 100, minComplexityLeft: 50_000, maxWaitMs: 120_000 };

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}

/** Expected ownership computed independently of the connector's scope implementation. */
function plcWorkspace(ws: Workspace): Workspace {
  const ref = (r: Record<string, unknown>, k: string) => (r[k] as { id?: string } | null)?.id;
  const teamIds = new Set(ws.teams!.filter((r) => r.key === 'PLC').map((r) => r.id));
  const owned = (r: Record<string, unknown>) => teamIds.has(ref(r, 'team'));
  const projects = ws.projects!.filter((r) => (r.teams as { nodes: { id: string }[] }).nodes.some((t) => teamIds.has(t.id)));
  const projectIds = new Set(projects.map((r) => r.id));
  const issues = ws.issues!.filter(owned), issueIds = new Set(issues.map((r) => r.id));
  const comments = ws.comments!.filter((r) => issueIds.has(ref(r, 'issue')));
  const userIds = new Set([...projects.map((r) => ref(r, 'lead')), ...issues.flatMap((r) => [ref(r, 'assignee'), ref(r, 'creator')]), ...comments.map((r) => ref(r, 'user'))]);
  return { teams: ws.teams!.filter((r) => teamIds.has(r.id)), users: ws.users!.filter((r) => userIds.has(String(r.id))),
    states: ws.states!.filter(owned), labels: ws.labels!.filter(owned), projects,
    milestones: ws.milestones!.filter((r) => projectIds.has(ref(r, 'project'))), cycles: ws.cycles!.filter(owned), issues, comments };
}

export async function linearProperties(check: Check, db: Db) {
  // ── No mutation leaves the client ─────────────────────────────────────────────────────────
  const hostile = [
    'mutation { issueCreate(input: {title: "x"}) { success } }',
    'MUTATION { issueDelete(id: "1") { success } }',
    'query A { viewer { id } } mutation B { issueUpdate(id: "1", input: {}) { success } }',
    '# a comment\nmutation { x }',
    'subscription { issueUpdates { id } }',
    '  { viewer { id } }\nmutation M { y }',
    'fragment F on Issue { id } mutation { z }',
  ];
  const refusedAll = hostile.every((t) => { try { assertReadOnly(t); return false; } catch (e) { return e instanceof LinearRefused; } });
  const allowOk = Object.values(QUERIES).every((q) => { try { assertReadOnly(q.text); return true; } catch { return false; } });
  const stringOk = (() => { try { assertReadOnly('query { issues(filter: {title: {contains: "mutation"}}) { nodes { id } } }'); return true; } catch { return false; } })();
  check('Linear read-only: every mutation or subscription text is refused; every allowlisted query passes', refusedAll && allowOk && stringOk,
    `${hostile.length} hostile texts refused (a comment or a second operation cannot hide one); ${Object.keys(QUERIES).length} allowlisted queries pass; the word inside a string is not an operation.`);

  const sent: string[] = [];
  const client = linearClient({ transport: fixtureTransport({ sent }), key: KEY, limits, sleep: async () => {} });
  let unlisted = false;
  try { await client.request('issueCreate' as never, {}); } catch (e) { unlisted = e instanceof LinearRefused; }
  let frozen = false;
  try { (QUERIES as Record<string, unknown>).Sneaky = { text: 'mutation { x }', entity: null, root: null, purpose: '' }; } catch { frozen = true; }
  check('Linear read-only: a name off the allowlist is refused before anything is sent, and the allowlist cannot be extended at run time',
    unlisted && frozen && sent.length === 0 && !Object.hasOwn(QUERIES, 'Sneaky'),
    `refused ${unlisted}, allowlist frozen ${Object.isFrozen(QUERIES)}, bodies sent ${sent.length}.`);

  // A whole sync through the fixture: every body that left names an allowlisted operation and carries its exact text.
  const root = await mkdtemp(join(tmpdir(), 'plcos-linear-'));
  const actor = (await db.one<{ id: string }>('select id::text from platform.app_user where active order by handle limit 1'))!.id;
  const bodies: string[] = [];
  const texts = new Set(Object.values(QUERIES).map((q) => q.text));
  const logged: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  console.warn = console.log; console.error = console.log;
  let first: Awaited<ReturnType<typeof syncLinear>> | null = null;
  try {
    first = await syncLinear(db, actor, { source: { transport: fixtureTransport({ sent: bodies }), key: KEY }, root });
  } finally { Object.assign(console, orig); }
  const everyBodyAllowed = bodies.every((b) => { const j = JSON.parse(b); return texts.has(j.query) && QUERIES[j.operationName]?.text === j.query && !/\bmutation\b/i.test(j.query); });
  check('Linear read-only: every request of a full sync is an allowlisted query, sent verbatim',
    bodies.length >= ENTITIES.length && everyBodyAllowed,
    `${bodies.length} requests for ${ENTITIES.length} entities; none carried a text outside the allowlist.`);

  const teamScopedBodies = bodies.every((b) => {
    const request = JSON.parse(b);
    return JSON.stringify(request.variables.teamKeys) === '["PLC"]'
      && (request.operationName === opName('users') ? /id: \{ in: \$userIds \}/.test(request.query)
        : /key: \{ in: \$teamKeys \}/.test(request.query));
  });
  check('Linear team scope: every content query includes an immutable server-side scope and users are requested by referenced IDs',
    teamScopedBodies && bodies.filter((b) => JSON.parse(b).operationName !== opName('users')).every((b) => JSON.parse(b).query.includes('filter: { and: [$filter,')),
    `${bodies.length} requests carry PLC scope; every collection combines the caller filter with the mandatory scope.`);
  check('Linear team scope: project and milestone filters use the schema’s accessibleTeams relation',
    QUERIES[opName('projects')]!.text.includes('accessibleTeams: { some: { key: { in: $teamKeys } } }')
      && QUERIES[opName('milestones')]!.text.includes('project: { accessibleTeams: { some: { key: { in: $teamKeys } } } }'),
    'Both immutable project ownership filters use ProjectFilter.accessibleTeams.');
  const overrideBodies: string[] = [];
  const overrideClient = linearClient({ transport: fixtureTransport({ sent: overrideBodies }), key: KEY, limits, sleep: async () => {} });
  await overrideClient.request(opName('issues'), { first: 100, teamKeys: ['OPS'], filter: { or: [{ team: { key: { eq: 'OPS' } } }] } });
  const overrideRequest = JSON.parse(overrideBodies[0]!);
  check('Linear team scope: caller variables cannot replace the configured allowlist',
    JSON.stringify(overrideRequest.variables.teamKeys) === '["PLC"]' && overrideRequest.query.includes('filter: { and: [$filter,'),
    'A caller-supplied OPS key and OR filter remain constrained by the configured PLC allowlist.');

  let postShape = '';
  await httpsTransport((async (url: string, init: RequestInit) => { postShape = `${init.method} ${url} ${init.redirect}`; return new Response('{"data":{}}'); }) as unknown as typeof fetch).post('{}', {});
  check('Linear read-only: the HTTPS transport posts to the one endpoint and refuses redirects',
    postShape === `POST ${LINEAR_ENDPOINT} error`, postShape);

  // ── The key is never logged ────────────────────────────────────────────────────────────────
  const allWorkspace = loadWorkspace();
  const ws = plcWorkspace(allWorkspace);
  const counts = Object.fromEntries(ENTITIES.map((e) => [e, (ws[e] ?? []).length]));
  const dbText = JSON.stringify(await db.query(`select (select json_agg(a) from platform.audit_log a where action like 'linear.%') audit,
    (select json_agg(s) from platform.source_sync s where source='linear') sync`));
  const files = await walk(root);
  const fileText = (await Promise.all(files.map((f) => readFile(f, 'utf8')))).join('\n');
  // A transport that fails with the key in its message, and one that echoes it in a 500 body.
  const activityRoot = await mkdtemp(join(tmpdir(), 'plcos-linear-act-'));
  const leaky: LinearTransport = { kind: 'scripted', post: async () => { throw new Error(`socket closed for ${KEY}`); } };
  const echo: LinearTransport = { kind: 'scripted', post: async () => ({ status: 500, headers: new Headers(), text: async () => JSON.stringify({ errors: [{ message: `bad key ${KEY}` }] }) }) };
  const thrown: string[] = [];
  for (const t of [leaky, echo]) {
    const c = linearClient({ transport: t, key: KEY, limits, sleep: async () => {}, activityRoot });
    try { await c.request('LinearTest'); } catch (e) { thrown.push(`${(e as Error).message} ${(e as Error).stack ?? ''}`); }
  }
  let syncErr = '';
  try { await syncLinear(db, actor, { source: { transport: echo, key: KEY }, root }); } catch (e) { syncErr = (e as Error).message; }
  const actText = (await Promise.all((await walk(activityRoot)).map((f) => readFile(f, 'utf8')))).join('\n');
  const sourceRow = JSON.stringify(await db.query(`select * from platform.source_sync where source='linear'`));
  process.env.LINEAR_API_KEY = KEY;
  const demoKey = linearKey();
  const stripped = !('LINEAR_API_KEY' in withoutLinearKey(process.env));
  delete process.env.LINEAR_API_KEY;
  const leaks = [logged.join('\n'), dbText, fileText, thrown.join('\n'), syncErr, actText, sourceRow, JSON.stringify(first)].filter((x) => x.includes(KEY)).length;
  check('Linear key: never in a log, an error, the activity log, the replica, a manifest, the audit log or the source row',
    leaks === 0 && thrown.length === 2 && thrown.every((t) => t.includes('[key]') || !t.includes('lin_api')) && actText.length > 0 && syncErr === 'Linear sync stopped.',
    `${leaks} places held it; ${thrown.length} failures were redacted; the stopped sync says only “${syncErr}”.`);
  check('Linear key: the demo never reads it, and a preview’s environment drops it', demoKey === null && stripped,
    `demo read ${demoKey === null ? 'nothing' : 'a key'}; preview env ${stripped ? 'without' : 'with'} it.`);

  // ── Pagination and backoff ─────────────────────────────────────────────────────────────────
  const pageBodies: string[] = [];
  const small = linearClient({ transport: fixtureTransport({ sent: pageBodies }), key: KEY, limits, sleep: async () => {} });
  const seen: string[] = [];
  let pages = 0;
  for await (const nodes of small.pages<{ id: string }>(opName('issues'), null, 5)) { pages++; seen.push(...nodes.map((x) => x.id)); }
  const cursors = pageBodies.map((b) => JSON.parse(b).variables.after);
  check('Linear pages: the cursor is followed to the end, with no record twice and none missed',
    pages === Math.ceil(counts.issues / 5) && seen.length === counts.issues && new Set(seen).size === counts.issues && cursors[0] === null && cursors.slice(1).every((c, i) => c !== cursors[i]),
    `${counts.issues} invented issues in pages of 5: ${pages} pages, ${seen.length} records, cursors ${cursors.map(String).join(', ')}.`);

  const stuck: LinearTransport = { kind: 'scripted', post: async () => ({ status: 200, headers: new Headers(), text: async () => JSON.stringify({ data: { issues: { nodes: [{ id: 'a' }], pageInfo: { hasNextPage: true, endCursor: 'same' } } } }) }) };
  let loopStopped = false;
  try { let k = 0; for await (const _ of linearClient({ transport: stuck, key: KEY, limits, sleep: async () => {} }).pages(opName('issues'), null, 1)) { if (++k > 5) break; } }
  catch (e) { loopStopped = e instanceof LinearError; }
  check('Linear pages: a next page that repeats its cursor stops the read instead of looping', loopStopped, 'A repeated cursor is an error, not another page.');

  const sleeps: number[] = [];
  let clock = 1_000_000;
  const now = () => clock;
  const sleep = async (ms: number) => { sleeps.push(ms); clock += ms; };
  const limited = linearClient({ transport: fixtureTransport({ limitFirst: 2, now }), key: KEY, limits, sleep, now });
  const ok = await limited.request<{ teams: { nodes: { id: string }[] } }>('LinearTest');
  const st = limited.stats();
  let gaveUp = false;
  try { await linearClient({ transport: fixtureTransport({ limitFirst: 99, now }), key: KEY, limits, sleep, now }).request('LinearTest'); }
  catch (e) { gaveUp = e instanceof LinearError && e.status === 429; }
  check('Linear backoff: a 429 or RATELIMITED waits for the reset and tries again; four refusals end the read',
    ok.teams.nodes.length === counts.teams && st.retries === 2 && st.requests === 3 && sleeps.length >= 2 && sleeps.every((ms) => ms >= 1000 && ms <= limits.maxWaitMs) && gaveUp,
    `${st.requests} requests, ${st.retries} retries, waits ${sleeps.slice(0, 2).join(' and ')} ms; a fourth refusal stops with 429.`);

  sleeps.length = 0;
  const low = linearClient({ transport: fixtureTransport({ requestsLeft: 50, now }), key: KEY, limits, sleep, now });
  await low.request('LinearTest');
  await low.request('LinearTest');
  const waitedForReset = sleeps.length === 1 && sleeps[0]! >= 1000;
  let farStops = false;
  const far: LinearTransport = { kind: 'scripted', post: async () => ({ status: 200, text: async () => '{"data":{"viewer":{"id":"x"},"teams":{"nodes":[]}}}',
    headers: new Headers({ 'x-ratelimit-requests-limit': '2500', 'x-ratelimit-requests-remaining': '10', 'x-ratelimit-requests-reset': String(clock + 3_600_000) }) }) };
  const farClient = linearClient({ transport: far, key: KEY, limits, sleep, now });
  await farClient.request('LinearTest');
  try { await farClient.request('LinearTest'); } catch (e) { farStops = e instanceof LinearError && e.status === 429; }
  check('Linear budget: under the floor it waits for the reset, and stops when the reset is too far off to hold a job open',
    waitedForReset && farStops, `waited ${sleeps[0] ?? 0} ms for a near reset; an hour-away reset stopped the read.`);

  // ── The replica translation ────────────────────────────────────────────────────────────────
  const rows = await db.one<Record<string, string>>(`select (select count(*) from linear.issue) issues, (select count(*) from linear.project) projects,
    (select count(*) from linear.team) teams, (select count(*) from linear.comment) comments, (select count(*) from linear.member) members`);
  check('Linear translation: a first sync lands every invented record once',
    Number(rows!.issues) === counts.issues && Number(rows!.projects) === counts.projects && Number(rows!.teams) === counts.teams
      && Number(rows!.comments) === counts.comments && Number(rows!.members) === counts.users && first!.inserted === Object.values(counts).reduce((a, b) => a + b, 0),
    `${rows!.issues} issues, ${rows!.projects} projects, ${rows!.teams} teams, ${rows!.comments} comments, ${rows!.members} members; ${first!.inserted} inserted.`);

  // Incremental: the next pull asks only for changes, with a filter on updatedAt.
  const second: string[] = [];
  const again = await syncLinear(db, actor, { source: { transport: fixtureTransport({ sent: second }), key: KEY }, root });
  const filtered = second.filter((b) => !['LinearTeams', 'LinearUsers'].includes(JSON.parse(b).operationName)).every((b) => JSON.parse(b).variables.filter?.updatedAt?.gt);
  check('Linear incremental: after a complete sync, content queries filter on updatedAt and nothing unchanged is rewritten',
    filtered && again.incremental === 1 && again.inserted === 0 && again.updated === 0,
    `${second.length} requests, all filtered; ${again.inserted} inserted, ${again.updated} updated.`);

  // A later pull, written by hand: an explicit null clears, an absent field stays, an older record loses.
  const raw = join(root, 'linear', 'raw');
  const stamp = '2099-01-01T00-00-00-000Z';
  const issue = ws.issues!.find((i) => i.assignee && i.dueDate && (i.labelIds as string[]).length)!;
  const older = ws.issues!.find((i) => i.id !== issue.id)!;
  const later = { id: issue.id, updatedAt: '2099-01-01T00:00:00.000Z', assignee: null, dueDate: null, labelIds: [], estimate: null, description: null };
  const stale = { ...older, title: 'An older title that must not win', updatedAt: '2000-01-01T00:00:00.000Z' };
  for (const e of ENTITIES) { await mkdir(join(raw, e), { recursive: true }); await writeFile(join(raw, e, `${stamp}.jsonl`), e === 'issues' ? `${JSON.stringify(later)}\n${JSON.stringify(stale)}\n` : ''); }
  await writeFile(join(raw, `${stamp}.manifest.json`), JSON.stringify({ at: '2099-01-01T00:00:00.000Z', finishedAt: '2099-01-01T00:00:01.000Z', since: null, full: false, requests: 0, bytesIn: 0, bytesOut: 0, records: 2,
    budget: { requestsLeft: null, requestsLimit: null, complexityLeft: null, complexityLimit: null },
    entities: Object.fromEntries(ENTITIES.map((e) => [e, { written: e === 'issues' ? 2 : 0 }])), complete: true }));
  const third = await translateLinear(db, actor, await readReplicas(raw), { batch: 1 });
  const after = await db.one<Record<string, unknown>>('select assignee_id, due_date, label_ids, estimate, description, title, project_id from linear.issue where id = $1', [issue.id]);
  const olderRow = await db.one<{ title: string }>('select title from linear.issue where id = $1', [older.id]);
  check('Linear translation: an explicit null clears a field, an absent one is kept, and an older record never replaces a newer one',
    after!.assignee_id === null && after!.due_date === null && Array.isArray(after!.label_ids) && (after!.label_ids as string[]).length === 0
      && after!.description === null && after!.title === issue.title && after!.project_id === (issue.project as { id: string } | null)?.id
      && olderRow!.title === older.title && third.updated === 1 && third.unchanged === 1,
    `assignee, due date, labels, estimate and description cleared; title and project kept; the stale record left “${olderRow!.title}”.`);

  const replay = await translateLinear(db, actor, await readReplicas(raw), { batch: 3 });
  await writeFile(join(raw, 'issues', `${stamp}.jsonl`), `${JSON.stringify({ ...later, title: 'rewritten' })}\n${JSON.stringify(stale)}\n`);
  let refused = false;
  try { await translateLinear(db, actor, await readReplicas(raw), { batch: 3 }); } catch (e) { refused = /changed/.test((e as Error).message); }
  let badShape = false;
  try { normalize('issues', { id: 'x', updatedAt: '2026-01-01T00:00:00Z', assignee: 'not-an-object' }); } catch { badShape = true; }
  check('Linear translation: a replay writes nothing, a translated file that changes is refused, and a malformed record stops the read',
    replay.files === 0 && replay.inserted + replay.updated === 0 && refused && badShape,
    `replay touched ${replay.files} files; changed file refused ${refused}; malformed record refused ${badShape}.`);

  // A pull that stops part-way keeps what finished and does not become the next pull's starting point.
  const failing: LinearTransport = { kind: 'scripted', post: async (body) => JSON.parse(body).operationName === opName('issues')
    ? { status: 503, headers: new Headers(), text: async () => '{}' } : fixtureTransport().post(body, {}) };
  const partialDir = join(root, 'partial');
  const partial = await pullLinear(linearClient({ transport: failing, key: KEY, limits, sleep: async () => {} }), partialDir, { pageSize: 100, overlapMs: 0 });
  const nextSince = await pullLinear(linearClient({ transport: fixtureTransport(), key: KEY, limits, sleep: async () => {} }), partialDir, { pageSize: 100, overlapMs: 0 });
  check('Linear pull: a pull that stops is marked incomplete, keeps what it read, and the next pull reads everything again',
    !partial.complete && partial.entities.issues?.error === 'read failed' && (partial.entities.teams?.written ?? 0) > 0 && nextSince.since === null && nextSince.complete,
    `stopped at issues (${partial.entities.issues?.error}); ${partial.entities.teams?.written} teams kept; the next pull started from nothing.`);

  const changedScope = await pullLinear(linearClient({ transport: fixtureTransport(), key: KEY, limits, teams: ['OPS'], sleep: async () => {} }), partialDir, { pageSize: 100, overlapMs: 0 });
  check('Linear team scope: changing the allowlist restarts the pull without an old team’s watermark',
    changedScope.complete && changedScope.since === null && JSON.stringify(changedScope.teams) === '["OPS"]',
    'An OPS pull after a completed PLC pull starts from the beginning and pins its own scope.');

  // Legacy mixed-team replicas and existing database rows must both be purged, including orphan files.
  const rebuildRoot = await mkdtemp(join(tmpdir(), 'plcos-linear-rebuild-'));
  const rebuildRaw = join(rebuildRoot, 'linear', 'raw');
  const legacyStamp = '2026-09-27T00-00-00-000Z';
  const overviewBeforeLegacy = await linearOverview(db);
  const mixed = structuredClone(allWorkspace);
  const foreignIds = ENTITIES.map((e) => `forbidden-${e}`);
  for (const entity of ENTITIES) {
    const foreign: Record<string, unknown> = { id: `forbidden-${entity}`, updatedAt: '2026-09-27T00:00:00.000Z' };
    if (entity === 'teams') Object.assign(foreign, { key: 'OTHER', name: 'Private other team' });
    else if (entity === 'projects') Object.assign(foreign, { teams: { nodes: [{ id: 'forbidden-teams' }] }, lead: { id: 'forbidden-users' } });
    else if (entity === 'comments') Object.assign(foreign, { issue: { id: 'forbidden-issues' }, user: { id: 'forbidden-users' } });
    else if (entity === 'milestones') Object.assign(foreign, { project: { id: 'forbidden-projects' } });
    else if (entity !== 'users') Object.assign(foreign, { team: { id: 'forbidden-teams' } });
    mixed[entity]!.push(foreign);
    await mkdir(join(rebuildRaw, entity), { recursive: true });
    await writeFile(join(rebuildRaw, entity, `${legacyStamp}.jsonl`), mixed[entity]!.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await writeFile(join(rebuildRaw, entity, 'orphan.jsonl'), JSON.stringify(foreign) + '\n');
    await writeFile(join(rebuildRaw, entity, 'orphan.jsonl.filtered'), JSON.stringify(foreign) + '\n');
    await db.query(`insert into linear.${TABLE[entity]} (id,updated_at,replica_file) values ($1,'2026-09-27T00:00:00Z','legacy')`, [foreign.id]);
  }
  await db.query("update linear.team set key='OTHER',name='Private other team' where id='forbidden-teams'");
  for (const entity of ['states','labels','cycles','issues'] as const) await db.query(`update linear.${TABLE[entity]} set team_id='forbidden-teams' where id=$1`, [`forbidden-${entity}`]);
  await db.query("update linear.project set team_ids=array['forbidden-teams'],lead_id='forbidden-users' where id='forbidden-projects'");
  await db.query("update linear.comment set issue_id='forbidden-issues',user_id='forbidden-users' where id='forbidden-comments'");
  await db.query("update linear.milestone set project_id='forbidden-projects' where id='forbidden-milestones'");
  const overviewWithLegacy = await linearOverview(db);
  check('Linear views: disallowed legacy rows cannot change any overview count or reading before rebuild',
    JSON.stringify(overviewWithLegacy) === JSON.stringify(overviewBeforeLegacy),
    'Every entity table contains a disallowed legacy row; Developer Linear still returns the same allowed-team overview.');
  await writeFile(join(rebuildRaw, `${legacyStamp}.manifest.json`), JSON.stringify({
    at: '2026-09-27T00:00:00.000Z', finishedAt: '2026-09-27T00:00:01.000Z', since: null, full: true, complete: true,
    requests: 0, bytesIn: 0, bytesOut: 0, records: Object.values(mixed).reduce((n, r) => n + r.length, 0),
    entities: Object.fromEntries(ENTITIES.map((e) => [e, { written: mixed[e]!.length }])),
    budget: { requestsLeft: null, requestsLimit: null, complexityLeft: null, complexityLimit: null },
  }));
  // Direct translation must reject foreign rows even before the rebuild's filesystem pass.
  const translated = await readReplicas(rebuildRaw);
  for (const entity of ENTITIES) await db.query(`delete from linear.${TABLE[entity]} where id = $1`, [`forbidden-${entity}`]);
  await translateLinear(db, actor, translated, { batch: 2 });
  const foreignRows = async () => {
    let n = 0;
    for (const entity of ENTITIES) n += Number((await db.one<{ n: string }>(`select count(*) n from linear.${TABLE[entity]} where id = any($1::text[])`, [foreignIds]))!.n);
    return n;
  };
  check('Linear team scope: direct translation refuses disallowed teams and their dependent records',
    await foreignRows() === 0, 'All nine entity types include an invented disallowed record; none entered the database.');
  for (const entity of ENTITIES) await db.query(`insert into linear.${TABLE[entity]} (id,updated_at,replica_file) values ($1,'2026-09-27T00:00:00Z','legacy')`, [`forbidden-${entity}`]);
  const rebuilt = await rebuildLinear(db, actor, { root: rebuildRoot });
  const snapshot = async () => {
    const out: unknown[] = [];
    for (const entity of ENTITIES) out.push(await db.query(`select to_jsonb(t) - 'synced_at' as record from linear.${TABLE[entity]} t order by id`));
    return JSON.stringify(out);
  };
  const beforeRepeat = await snapshot();
  const survivingFiles = await walk(rebuildRaw);
  const rawContents = (await Promise.all(survivingFiles.map((f) => readFile(f, 'utf8')))).join('\n');
  const allExpected = await Promise.all(ENTITIES.map(async (e) => Number((await db.one<{ n: string }>(`select count(*) n from linear.${TABLE[e]}`))!.n) === counts[e]));
  check('Linear rebuild: removes other-team raw records, orphan files and legacy database rows, then remaps the allowed replica',
    rebuilt.requests === 0 && rebuilt.purged > 0 && rebuilt.removedFiles >= ENTITIES.length && await foreignRows() === 0
      && !rawContents.includes('forbidden-') && !rawContents.includes('Private other team') && allExpected.every(Boolean)
      && survivingFiles.every((f) => !f.endsWith('orphan.jsonl') && !f.endsWith('.filtered')),
    `${rebuilt.purged} records purged, ${rebuilt.removedFiles} files removed; no network requests; every table matches the allowed fixture.`);
  const repeated = await rebuildLinear(db, actor, { root: rebuildRoot });
  check('Linear rebuild: repeating the purge and remap is idempotent',
    repeated.purged === 0 && repeated.removedFiles === 0 && await snapshot() === beforeRepeat,
    `Second rebuild purged ${repeated.purged} records and removed ${repeated.removedFiles} files; rows are identical.`);
  const rebuildAudit = await db.query<{ detail: unknown }>("select detail from platform.audit_log where action='linear.rebuilt'");
  check('Linear rebuild: audit detail contains counts only', rebuildAudit.length >= 2 && rebuildAudit.every((r) =>
    r.detail && typeof r.detail === 'object' && Object.values(r.detail).every((v) => typeof v === 'number')),
    `${rebuildAudit.length} rebuild audit entries; no names, IDs or raw records.`);
  const movedIssue = ws.issues![0]!;
  const movedReplicas = await readReplicas(rebuildRaw);
  movedReplicas.push({ entity: 'issues', file: 'issues/transfer.jsonl', hash: 'invented-transfer', at: '2100-01-01T00:00:00Z',
    records: [normalize('issues', { id: movedIssue.id, updatedAt: '2100-01-01T00:00:00Z', team: { id: 'team-ops' } })] });
  await translateLinear(db, actor, movedReplicas, { batch: 2 });
  const movedRows = await db.one<{ issues: string; comments: string }>(`select
    (select count(*) from linear.issue where id=$1) issues,
    (select count(*) from linear.comment where issue_id=$1) comments`, [movedIssue.id]);
  check('Linear team scope: a transfer out removes the old issue and dependent comments instead of replaying its earlier allowed version',
    Number(movedRows!.issues) === 0 && Number(movedRows!.comments) === 0,
    'A newer out-of-scope team assignment removes the stored issue and its comments.');
  await rm(rebuildRoot, { recursive: true, force: true });

  await rm(root, { recursive: true, force: true });
  await rm(activityRoot, { recursive: true, force: true });
}
