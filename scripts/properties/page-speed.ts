/**
 * Page speed (2 Oct 2026, docs/changelog/entries/page-speed.md): the route topology load walks
 * the primary key instead of sorting the entity table for every page; no SQL sorts on a ::text
 * output column it shadows; the page warm-up waits for data to settle and never runs during imports.
 */
import { readFileSync } from 'node:fs';
import type { Check } from './harness';
import { openTestDb } from './database';
import { migrate } from '../../lib/db/migrate';
import { orderByShadows } from '../../lib/dev/sql-order-shadow';
import { scan } from '../sql-shadow-scan';
import { topologyPageSql } from '../../modules/network/route-policy';
import { needsSignIn, warmDecision, warmPaths, type WarmState } from '../../lib/page-warm';

// Reviewed hits that are not keyset paging over a large table. A new hit fails until reviewed.
const REVIEWED = new Set([
  'modules/content/repo.ts:76 order by instrument', // a dozen wrap rules; text order is the display order
  'modules/network/repo.ts:160 order by tier', // four aggregated rows
  'modules/strategy/repo.ts:115 order by rung', // one LP's ladder events; callers regroup them
]);

export async function pageSpeedProperties(check: Check) {
  // The shapes that cost 4.3 s (route topology) and a full sort per page (identity resolution).
  const before = orderByShadows('`select entity_id::text, entity_type::text from identity.entity where entity_id > $1::uuid order by entity_id limit 2048`');
  const resolution = orderByShadows('`select edge_id::text,left_entity::text from identity.possible_match where edge_id > $1 order by edge_id limit $2`');
  check('page-speed: the scanner flags an ORDER BY that sorts on its own ::text output column', before.length === 1 && resolution.length === 1, JSON.stringify([before, resolution]));
  const fine = [
    '`select e.entity_id::text, e.display_name from identity.entity e order by e.entity_id limit 10`',
    '`select entity_id::text id from identity.entity order by entity_id`',
    '`select entity_id::text as id from x where entity_id::text > $1 order by entity_id`',
  ].flatMap((s) => orderByShadows(s));
  check('page-speed: a qualified column, an aliased cast or a cast in WHERE is not flagged', fine.length === 0, JSON.stringify(fine));
  check('page-speed: the route topology page query is not flagged', orderByShadows(`\`${topologyPageSql(true)}\``).length === 0, topologyPageSql(true));

  const hits = scan().filter((h) => !REVIEWED.has(h));
  check('page-speed: no SQL in lib, modules or app sorts on a ::text output column it shadows (lib/dev/sql-order-shadow.ts)', hits.length === 0, hits.join('; '));
  const resolutionSource = readFileSync('modules/identity/resolution.ts', 'utf8');
  check('page-speed: identity resolution pages possible matches by the uuid column', /order by m\.edge_id limit/.test(resolutionSource), 'modules/identity/resolution.ts');

  // The plan, on enough rows that the planner must choose: an index walk, no sort.
  const db = await openTestDb();
  try {
    await migrate(db);
    await db.exec(`insert into identity.entity (entity_type, display_name) select 'person', 'Person ' || g from generate_series(1, 20000) g; analyze identity.entity`);
    const plan = async (sql: string) => (await db.query<{ 'QUERY PLAN': string }>(`explain ${sql.replace('$1::uuid', `'80000000-0000-0000-0000-000000000000'::uuid`)}`)).map((r) => r['QUERY PLAN']).join('\n');
    const fixed = await plan(topologyPageSql(true));
    check('page-speed: a topology page walks the entity primary key without a sort', /Index Scan using entity_pkey/.test(fixed) && !/\bSort\b/.test(fixed), fixed);
    const old = await plan(`select entity_id::text, entity_type::text, display_name, merged_into::text from identity.entity
      where entity_id > $1::uuid order by entity_id limit 2048`);
    check('page-speed: the old topology query sorted (the property tells the two apart)', /\bSort\b/.test(old), old);
    const rows = await db.query<{ entity_id: string }>(topologyPageSql(false));
    const next = await db.query<{ entity_id: string }>(topologyPageSql(true), [rows.at(-1)!.entity_id]);
    const ids = [...rows, ...next].map((r) => r.entity_id);
    check('page-speed: topology pages are consecutive, ordered and without repeats',
      rows.length === 2048 && next.length === 2048 && new Set(ids).size === ids.length && ids.every((id, i) => i === 0 || ids[i - 1]! < id), `${rows.length}+${next.length}`);
  } finally { await db.close(); }

  // A redirect to sign-in or setup is not a failure (5 Oct 2026: "14 failed" at each Railway boot).
  check('page-speed warm: a redirect to sign-in or setup counts as needing a sign-in, not as a failure',
    needsSignIn(307, '/signin?next=%2Ftoday') && needsSignIn(307, 'http://127.0.0.1:3000/setup') && needsSignIn(302, '/signin')
      && !needsSignIn(500, null) && !needsSignIn(307, '/today') && !needsSignIn(307, '/signing-room') && !needsSignIn(200, '/signin'), '');
  // The warm-up's decision.
  const s = (o: Partial<WarmState> = {}): WarmState => ({ seen: null, warmed: null, lastWarmAt: 0, running: false, ...o });
  const at = 1_000_000;
  check('page-speed warm: a revision seen for the first time waits for it to settle', warmDecision(s(), { revision: 'a', importActive: false }, at) === 'wait', '');
  check('page-speed warm: the same revision on two looks is warmed', warmDecision(s({ seen: 'a' }), { revision: 'a', importActive: false }, at) === 'warm', '');
  check('page-speed warm: a revision already warmed is not warmed again', warmDecision(s({ seen: 'a', warmed: 'a' }), { revision: 'a', importActive: false }, at) === 'wait', '');
  check('page-speed warm: nothing is warmed while an import job is queued or running', warmDecision(s({ seen: 'a' }), { revision: 'a', importActive: true }, at) === 'wait', '');
  check('page-speed warm: one warm-up at a time', warmDecision(s({ seen: 'a', running: true }), { revision: 'a', importActive: false }, at) === 'wait', '');
  check('page-speed warm: warm-ups are at least the minimum gap apart',
    warmDecision(s({ seen: 'b', warmed: 'a', lastWarmAt: at - 10_000 }), { revision: 'b', importActive: false }, at, 30_000) === 'wait'
    && warmDecision(s({ seen: 'b', warmed: 'a', lastWarmAt: at - 31_000 }), { revision: 'b', importActive: false }, at, 30_000) === 'warm', '');
  check('page-speed warm: a revision still changing waits', warmDecision(s({ seen: 'a', warmed: 'a' }), { revision: 'b', importActive: false }, at) === 'wait', '');
  const paths = warmPaths(['neurotech', 'spv-x'], '/neurotech/pipeline/p1');
  check('page-speed warm: Today, each vehicle\'s pipeline and routes, then the LP page at start',
    JSON.stringify(paths) === JSON.stringify(['/today', '/neurotech/pipeline', '/neurotech/routes', '/spv-x/pipeline', '/spv-x/routes', '/neurotech/pipeline/p1']), paths.join(' '));
  const pageWarm = readFileSync('lib/page-warm.ts', 'utf8');
  check('page-speed warm: the warm-up only reads (GET requests, no write statements)',
    !/\b(insert|update|delete)\s+(into\s+)?[a-z_]+\./i.test(pageWarm) && !/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(pageWarm), 'lib/page-warm.ts');
}
