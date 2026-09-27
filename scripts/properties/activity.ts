import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Check } from './harness';
import type { ActivityPoint } from '../../lib/activity/types';
import { aggregate, host, segment, sources } from '../../lib/activity/model';
import { demoActivity } from '../../lib/activity/demo';
import { createActivityReader } from '../../lib/activity';
import { recordActivity, runKey } from '../../lib/activity/log';
import { encodeLine, type RunLine } from '../../lib/workflows/ledger';
import { openPglite } from '../../lib/db/pglite';
import { migrate } from '../../lib/db/migrate';
import { databaseActivity, databaseGeneration } from '../../lib/activity/database';
import type { Logged } from '../../lib/activity/backfill';

/** All records below are invented. Never reads the deployed data root or database. */
export async function activityProperties(check: Check) {
  const demo = demoActivity('2026-09-27T12:00:00.000Z');
  check('0103 demo covers thirty UTC days for all eight sources',
    sources.every(source => new Set(demo.points.filter(p => p.source === source).map(p => p.day)).size === 30),
    'Every source has a daily series, including planned connector activity in this fictional fixture.');
  check('0103 each demo source distinguishes actuals and estimates',
    sources.every(source => [true, false].every(estimated => demo.points.some(p => p.source === source && p.estimated === estimated)))
      && demo.points.every(p => !p.estimated || Boolean(p.basis?.trim())),
    'Estimated points always explain their basis; known activity is separately represented.');
  check('0103 origins contain only normalized hosts',
    demo.origins.length > 0 && demo.origins.every(o => o.origin === host(o.origin)),
    'No path, URL query, scheme, identity or credentials appears in a host series.');
  check('0103 host sanitizer rejects identities and strips URL content',
    host('https://EXAMPLE.org/private/Invented-Person?q=private#secret') === 'example.org'
      && [null, 'person@example.org', 'https://user:password@example.org', 'file:///tmp/private', '127.0.0.1', 'https://[::1]/', 'not a host'].every(v => host(v) === null),
    'Public hostname normalization accepts a URL only after discarding its personal path/query; non-host inputs fail closed.');
  check('0103 sub-series cannot carry a person name or arbitrary text',
    sources.every(source => segment(source, 'Invented Person') === null)
      && segment('agents', 'W1c') === 'W1c' && segment('dakota', 'account') === 'account',
    'Only finite operation labels and workflow IDs are admitted.');

  const base: ActivityPoint = { day: '2026-09-26', source: 'affinity', segment: 'lists', requests: 3, bytesIn: 700, bytesOut: 20, records: 14, estimated: false };
  const input = [base, { ...base, requests: 7, bytesIn: 300, bytesOut: 10, records: 6 }, { ...base, segment: 'notes', requests: 11, bytesIn: 500, bytesOut: 30, records: 8 }];
  const rolled = aggregate(input, [], demo.asOf).points;
  const metrics = ['requests', 'bytesIn', 'bytesOut', 'records'] as const;
  check('0103 daily totals equal the sum of segments without a duplicate headline',
    rolled.length === 2 && rolled.every(p => p.segment !== null)
      && metrics.every(k => rolled.reduce((n, p) => n + p[k]!, 0) === input.reduce((n, p) => n + p[k]!, 0)),
    'Three invented observations reduce to two segments while conserving requests, input/output bytes and records.');
  const missing = aggregate([base, { ...base, requests: null, bytesIn: null, bytesOut: null, records: null }], [], demo.asOf).points;
  check('0103 unrecorded quantities stay unknown in a sum',
    missing.length === 1 && metrics.every(k => missing[0][k] === null),
    'Adding a known quantity never silently turns an unknown quantity into zero.');
  const mixed = aggregate([base, { ...base, estimated: true, basis: 'Invented measured file size proxy.' }], [], demo.asOf).points;
  check('0103 estimates remain distinguishable after aggregation',
    mixed.length === 2 && mixed.some(p => p.estimated && Boolean(p.basis)) && mixed.some(p => !p.estimated),
    'Actual and estimated observations for the same day/segment remain separate leaf points.');

  const root = await mkdtemp(join(tmpdir(), 'plcos-activity-invented-'));
  try {
    const event = { at: '2026-09-25T13:14:00Z', source: 'fetch' as const, segment: 'Invented Person', runId: 'fixture-0103', requests: 1, bytesIn: 2048, bytesOut: 64, records: 1,
      origin: 'https://example.org/private/Invented-Person?q=SECRET_FIXTURE', name: 'Invented Person', query: 'SECRET_FIXTURE' };
    await recordActivity(event, root);
    await recordActivity({ ...event, requests: 2, bytesIn: 4096 }, root);
    const logFiles = (await readdir(join(root, 'activity'))).filter(f => f.endsWith('.jsonl'));
    const serialized = (await Promise.all(logFiles.map(f => readFile(join(root, 'activity', f), 'utf8')))).join('');
    check('0103 activity log is append-only and omits personal content',
      serialized.trim().split('\n').filter(Boolean).length === 2 && !/SECRET_FIXTURE|Invented Person|private\/|Invented-Person/.test(serialized),
      'Two writes preserve both count records while dropping names, query content, paths and arbitrary segment labels.');
    await appendFile(join(root, 'activity', logFiles[0]), serialized.split('\n').find(Boolean) + '\n{"partial":');
    await recordActivity({ ...event, requests: 4, records: 2 }, root);
    await recordActivity({ ...event, at: '2026-09-24T13:14:00Z', origin: 'https://www.sec.gov/Archives/Invented-Person', requests: 1 }, root);
    const stamp = '2026-09-23T10-00-00Z';
    await mkdir(join(root, 'dakota', 'raw', 'account'), { recursive: true });
    await writeFile(join(root, 'dakota', 'raw', 'account', `${stamp}.jsonl`), '{"invented":1}\n{"invented":2}\n');
    await writeFile(join(root, 'dakota', 'raw', `${stamp}.manifest.json`), JSON.stringify({ at: '2026-09-23T10:00:00Z', requests: 4, modules: { account: { expected: 2, written: 2 } } }));
    await mkdir(join(root, 'enrich', 'warehouse', 'pages'), { recursive: true });
    await writeFile(join(root, 'enrich', 'warehouse', 'graph-manifest.json'), JSON.stringify({ asOf: '2026-09-22T10:00:00Z', inputPages: [{ queryHash: 'a'.repeat(24), hash: 'invented-content-hash', rows: 3, retrievedAt: '2026-09-22T10:00:00Z' }] }));
    await writeFile(join(root, 'enrich', 'warehouse', 'pages', `${'a'.repeat(24)}.json`), '[{"invented":1},{"invented":2},{"invented":3}]');
    const run: RunLine = { event: 'started', runId: '00000000-0000-0000-0000-000000000103', parentRunId: null, workflow: 'W1', operation: 'research',
      protocol: { version: 'fixture', hash: 'b'.repeat(64) }, source: 'chatgpt', agent: 'fixture', model: 'fixture-model', launchFolder: '/invented', workerFolder: '/invented',
      batch: { id: 'fixture', manifest: 'invented', hash: 'c'.repeat(64), planned: 1 }, startedAt: '2026-09-21T12:00:00Z', endedAt: null,
      counts: { selected: 1, written: 1, valid: 1, failed: 0, skipped: 0 }, checks: [], usage: null, outcome: 'unknown', reason: null };
    const finish: RunLine = { ...run, event: 'finished', endedAt: '2026-09-21T12:01:00Z', outcome: 'succeeded',
      usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: null, source: 'measured' } };
    await mkdir(join(root, 'workflows'), { recursive: true });
    await writeFile(join(root, 'workflows', 'runs.jsonl'), encodeLine(run) + encodeLine(finish));
    const duplicateRun = '00000000-0000-0000-0000-000000000104';
    await writeFile(join(root, 'dakota', 'raw', '2026-09-26T10-00-00Z.manifest.json'), JSON.stringify({ at: '2026-09-26T10:00:00Z', runId: duplicateRun, requests: 99, modules: {} }));
    await recordActivity({ at: '2026-09-26T10:00:00Z', source: 'dakota', runId: duplicateRun, requests: 3, bytesIn: 512, bytesOut: 64, records: 0 }, root);

    let generation = 'fixture-v1';
    let databaseReads = 0;
    const reader = createActivityReader({ root, generation: async () => generation,
      database: async () => { databaseReads++; return { points: [], origins: [] }; } });
    const actual = await reader();
    check('0103 recorded actuals round-trip with exact counts and host totals',
      actual.points.filter(p => p.source === 'fetch').reduce((n, p) => n + (p.requests ?? 0), 0) === 7
        && actual.points.filter(p => p.source === 'fetch').every(p => !p.estimated)
        && actual.origins.find(o => o.origin === 'example.org')?.requests === 7,
      'Repeated calls in one run count as seven requests, including an append after a torn tail, without leaking the supplied URL.');
    check('0103 duplicate event IDs and a torn tail preserve the next appended event',
      actual.points.filter(p => p.source === 'fetch').reduce((n, p) => n + (p.records ?? 0), 0) === 4,
      'A copied log line is counted once; a truncated fragment is skipped and the next same-day append survives.');
    check('0103 SEC hosts are counted once under the SEC source',
      actual.points.filter(p => p.source === 'sec').reduce((n, p) => n + (p.requests ?? 0), 0) === 1
        && actual.origins.find(o => o.origin === 'www.sec.gov')?.requests === 1,
      'A fetch to a SEC subdomain moves into the SEC series without duplicating the fetch total.');
    check('0103 Dakota manifest and warehouse graph reconstruct history',
      actual.points.filter(p => p.source === 'dakota').reduce((n, p) => n + (p.records ?? 0), 0) === 2
        && actual.points.filter(p => p.source === 'warehouse').reduce((n, p) => n + (p.records ?? 0), 0) === 3
        && actual.points.filter(p => ['dakota', 'warehouse'].includes(p.source) && p.estimated).every(p => Boolean(p.basis)),
      'Recorded rows survive historical reconstruction; file-size and query-page proxies carry an estimate basis.');
    check('0103 actual run counts suppress a matching historical manifest',
      actual.points.filter(p => p.source === 'dakota').reduce((n, p) => n + (p.requests ?? 0), 0) === 7,
      'Three measured requests replace the matching 99-request backfill, while an unrelated four-request manifest remains.');
    check('0103 agent token usage is explicitly a byte estimate',
      actual.points.some(p => p.source === 'agents' && p.segment === 'W1' && p.bytesIn === 80 && p.bytesOut === 400 && p.estimated && Boolean(p.basis)),
      'A hundred input and twenty output tokens become 400 outbound and 80 inbound estimated bytes with a disclosed basis.');

    // Thousands of files represent a realistic historical corpus. They are intentionally
    // created after the first generation was cached: a warm read must not inspect them.
    const raw = join(root, 'enrich', 'raw');
    await mkdir(raw, { recursive: true });
    const finding = JSON.stringify({ key: 'invented-key', name: 'Invented Research Person', researched: { at: '2026-09-24T10:00:00Z', workflow: 'W1' },
      queries: ['SECRET_RESEARCH query'], facts: [{ field: 'role', value: 'Invented', source: { url: 'https://example.net/about/SECRET_RESEARCH' } }] });
    for (let start = 0; start < 2000; start += 100) {
      await Promise.all(Array.from({ length: 100 }, (_, offset) => writeFile(join(raw, `fixture-${start + offset}.json`), finding)));
    }
    const began = performance.now();
    const warm = await reader();
    const elapsed = performance.now() - began;
    check('0103 warm activity reads are cached and below 300 ms for 2000 files',
      databaseReads === 1 && elapsed < 300 && JSON.stringify(warm) === JSON.stringify(actual),
      `One generation uses one database read; warm read took ${elapsed.toFixed(1)} ms with 2000 invented raw files.`);
    generation = 'fixture-v2';
    const refreshed = await reader();
    check('0103 a new data generation invalidates the activity cache',
      databaseReads === 2 && refreshed.points.some(p => p.source === 'search' && p.estimated),
      'A changed generation triggers one new snapshot and picks up historical research files.');
    const refreshedBegan = performance.now();
    const reread = await reader();
    const refreshedElapsed = performance.now() - refreshedBegan;
    check('0103 a fully scanned 2000-file generation stays below 300 ms warm',
      databaseReads === 2 && reread === refreshed && refreshedElapsed < 300,
      `After all research documents were scanned, a cache hit took ${refreshedElapsed.toFixed(1)} ms without another database read.`);
    check('0103 research backfill flags estimates and exposes no person/query content',
      refreshed.points.filter(p => p.source === 'search' || p.source === 'fetch').every(p => !p.estimated || Boolean(p.basis))
        && !/SECRET_RESEARCH|Invented Research Person|invented-key/.test(JSON.stringify(refreshed)),
      'Only counts and canonical hosts leave the invented research documents; reconstruction has a basis.');
    const fileReader = createActivityReader({ root });
    const fileSnapshot = await fileReader();
    const fileWarmBegan = performance.now();
    const fileWarm = await fileReader();
    const fileWarmElapsed = performance.now() - fileWarmBegan;
    await recordActivity({ ...event, at: '2026-09-25T15:00:00Z', requests: 5 }, root);
    const fileChanged = await fileReader();
    const actualFetchRequests = (data: typeof fileSnapshot) => data.points.filter(p => p.source === 'fetch' && !p.estimated).reduce((n, p) => n + (p.requests ?? 0), 0);
    check('0103 default file generation caches the corpus and observes appended actuals',
      fileWarm === fileSnapshot && fileWarmElapsed < 300 && actualFetchRequests(fileChanged) === actualFetchRequests(fileSnapshot) + 5,
      `The production file marker gives a ${fileWarmElapsed.toFixed(1)} ms warm read across 2000 files; a log append invalidates and adds five measured requests.`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const db = await openPglite('memory://');
  try {
    await migrate(db);
    await db.exec(`insert into sources.request_log(at,source,endpoint,path,outcome,note) values
      ('2026-09-24T23:30:00-02:00','affinity','/v2/lists','/v2/lists','sent','INVENTED_SECRET_NAME'),
      ('2026-09-25T00:30:00Z','affinity','/v2/lists','/v2/lists','network_error','INVENTED_SECRET_NAME'),
      ('2026-09-25T00:30:00Z','affinity','/v2/lists','/v2/lists','refused','INVENTED_SECRET_NAME'),
      ('2026-09-26T10:00:00Z','affinity','/v2/notes','/v2/notes','sent','INVENTED_SECRET_NAME');
      insert into sources.raw_record(source,kind,source_id,payload_hash,payload) values
      ('affinity','lists','fixture-private-id','fixture-hash','{"name":"INVENTED_SECRET_NAME","detail":"INVENTED_SECRET_PAYLOAD"}');
      insert into sources.sync_run(id,source,kind,started_at,finished_at,status,records) values
      (1,'affinity','lists','2026-09-24T23:30:00-02:00','2026-09-25T02:00:00Z','ok',3),
      (2,'affinity','notes','2026-09-25T03:00:00Z','2026-09-25T04:00:00Z','ok',11),
      (3,'affinity','lists','2026-09-27T03:00:00Z',null,'running',99);
      insert into platform.audit_log(at,action,subject_type,detail) values
      ('2026-09-24T23:30:00-02:00','enrich.imported','fixture','{"mapped":6,"name":"INVENTED_SECRET_NAME"}'),
      ('2026-09-27T00:00:00Z','enrich.imported','fixture','{"mapped":99,"detail":"INVENTED_SECRET_PAYLOAD"}'),
      ('2026-09-25T00:00:00Z','unrelated.action','fixture','{"mapped":500}');`);
    const noLog: Logged = { points: [], origins: [], cutoffs: new Map(), runs: new Set() };
    const historical = await databaseActivity(db, noLog);
    const requests = historical.points.filter(p => p.source === 'affinity' && !p.estimated);
    check('0103 database requests use UTC dates and exclude refused attempts',
      requests.find(p => p.day === '2026-09-25' && p.segment === 'lists')?.requests === 2
        && requests.reduce((n, p) => n + (p.requests ?? 0), 0) === 3,
      'A local-date September 24 request and UTC September 25 request group together; sent network errors count, refused requests do not.');
    const sync = historical.points.find(p => p.source === 'affinity' && p.estimated && p.day === '2026-09-25' && p.segment === 'lists');
    check('0103 database byte reconstruction discloses measured payload estimates',
      sync?.records === 3 && (sync.bytesIn ?? 0) > 0 && Boolean(sync.basis)
        && historical.points.filter(p => p.source === 'intake').every(p => p.estimated && Boolean(p.basis))
        && historical.points.find(p => p.source === 'intake' && p.day === '2026-09-25')?.records === 6,
      'Sync records use mean stored payload bytes, and recognized import audit rows retain their UTC counts with estimate bases.');
    check('0103 database adapter never exposes payloads or identity fields',
      !/INVENTED_SECRET|fixture-private-id|fixture-hash|unrelated.action/.test(JSON.stringify(historical)) && historical.origins.length === 0,
      'Names, source IDs, raw payload fields and arbitrary audit actions stay inside the database.');
    const coveredLog: Logged = { ...noLog, cutoffs: new Map([['affinity', '2026-09-26T00:00:00Z'], ['intake', '2026-09-26T00:00:00Z']]), runs: new Set([`affinity:${runKey('2')}`]) };
    const remaining = await databaseActivity(db, coveredLog);
    check('0103 database actual run IDs and cutoffs suppress only covered history',
      remaining.points.filter(p => p.source === 'affinity').reduce((n, p) => n + (p.requests ?? 0), 0) === 2
        && remaining.points.filter(p => p.source === 'affinity').reduce((n, p) => n + (p.records ?? 0), 0) === 3
        && remaining.points.filter(p => p.source === 'intake').reduce((n, p) => n + (p.records ?? 0), 0) === 6,
      'The logged eleven-record run disappears, post-instrumentation activity is excluded, and earlier unmatched rows remain.');
    const generationBefore = await databaseGeneration(db);
    await db.exec(`insert into platform.audit_log(at,action,subject_type,detail) values
      ('2026-09-28T00:00:00Z','enrich.prospects','fixture','{"added":2}');`);
    const generationAfterAudit = await databaseGeneration(db);
    await db.exec(`update sources.sync_run set finished_at='2026-09-28T01:00:00Z',status='ok' where id=3`);
    const generationAfterFinish = await databaseGeneration(db);
    check('0103 database generation changes on imports and sync completion',
      generationBefore !== generationAfterAudit && generationAfterAudit !== generationAfterFinish,
      'An audit insert and completion of an existing running sync independently invalidate cached activity.');
  } finally {
    await db.close();
  }
}
