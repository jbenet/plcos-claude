import type { Check, SeedContext } from './harness';
import { freshDb } from './harness';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

// JSONB has one zero; the scorer can produce -0 for a zero-valued penalty.
// Preserve Date objects and every other value while comparing that numeric equivalence.
const snapshotValue = (value: unknown): unknown => value === 0 ? 0
  : value instanceof Date ? value
    : Array.isArray(value) ? value.map(snapshotValue)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshotValue(item)])) : value;
const sameSnapshot = (a: unknown, b: unknown) => isDeepStrictEqual(snapshotValue(a), snapshotValue(b));

export async function routeInputCacheProperties({ check, db }: SeedContext) {
  const { buildCache } = await import('../../lib/build-cache');
  const entityId = (await db.one<{ id: string }>(`insert into identity.entity (entity_type, display_name)
    values ('person', 'Picker generation before import') returning entity_id::text as id`))!.id;
  const name = async () => (await db.one<{ display_name: string }>(
    'select display_name from identity.entity where entity_id = $1', [entityId]))!.display_name;
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let loads = 0;
  const picker = buildCache(async () => {
    const attempt = ++loads, before = await name();
    if (attempt === 1) { enter(); await blocked; }
    return { before, after: await name() };
  });
  try {
    const first = picker(), second = picker();
    await entered;
    const coalesced = loads === 1;
    await db.query('update identity.entity set display_name = $2 where entity_id = $1',
      [entityId, 'Picker generation after import']);
    release();
    const [a, b] = await Promise.all([first, second]);
    const warm = await picker();
    check('CACHE concurrent picker requests discard a generation crossed by a database update',
      coalesced && loads === 2 && a === b && warm === a
        && a.before === 'Picker generation after import' && a.after === a.before,
      'Two waiting requests share the refreshed result; neither receives the mixed old/new load.');

    let attempts = 0;
    const retry = buildCache(async () => {
      const attempt = ++attempts, result = await name();
      if (attempt === 1) throw new Error('Invented picker read failure');
      return result;
    });
    const failed = await Promise.allSettled([retry(), retry()]);
    const recovered = await retry();
    check('CACHE a failed shared picker load is retried, then reused after success',
      failed.every((r) => r.status === 'rejected') && recovered === 'Picker generation after import'
        && await retry() === recovered && attempts === 2,
      'Concurrent callers share one failure; the next request loads fresh inputs and the following request reuses them.');
  } finally {
    release();
    await db.query('delete from identity.entity where entity_id = $1', [entityId]);
  }
}

/** Persisted route snapshots are interchangeable with the live, guarded search. */
export async function routeCacheProperties({ check, db, id }: SeedContext) {
  const { precomputeRoutes, planRoutes, planRoutesLive } = await import('../../modules/network');
  const { overlayRoutes } = await import('../../modules/network/route-overlay');
  const { routeGraph } = await import('../../modules/network/service');
  const { cachedRoutes } = await import('../../modules/network/cache');
  const empty = (await db.one<{ id: string }>(`insert into identity.entity (entity_type, display_name)
    values ('person', 'Cache fixture without connections') returning entity_id::text as id`))!.id;
  await db.query(`insert into strategy.pursuit (entity_id, vehicle_id, owner_id)
    select $1, v.id, u.id from platform.vehicle v cross join platform.app_user u
      where v.slug = 'rails' and u.handle = 'juan'`, [empty]);
  const at = new Date();
  try {
    // Earlier build properties deliberately mutate the graph while detached warming runs.
    // Join that run, then finish the current generation if it was superseded.
    let counts = await precomputeRoutes(at);
    for (let retry = 0; !counts.complete && retry < 3; retry++) counts = await precomputeRoutes(at);
    const persisted = await db.query<{ target_id: string; vehicle_kind: string }>(
      `select target_id::text, vehicle_kind from network.route_cache
       where input_revision = (select revision from network.route_revision where singleton)
       order by target_id, vehicle_kind`);
    let identical = true, dateCount = 0, difference = '';
    const firstDifference = (a: unknown, b: unknown, path = ''): string => {
      if (sameSnapshot(a, b)) return '';
      if (a && b && typeof a === 'object' && typeof b === 'object' && !(a instanceof Date) && !(b instanceof Date)) {
        const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
        for (const key of new Set([...Object.keys(aa), ...Object.keys(bb)])) {
          const diff = firstDifference(aa[key], bb[key], `${path}.${key}`);
          if (diff) return diff;
        }
        return `${path}: optional object keys differ`;
      }
      return `${path}: ${JSON.stringify(a)} versus ${JSON.stringify(b)}`;
    };
    const countDates = (value: unknown): number => value instanceof Date ? 1
      : value && typeof value === 'object' ? Object.values(value).reduce<number>((n, v) => n + countDates(v), 0) : 0;
    const { withDb } = await import('../../lib/db');
    const persistedReader = { ...db }; // Distinct handle cache forces JSONB deserialization.
    for (const row of persisted) {
      const base = await withDb(persistedReader, () => cachedRoutes(row.target_id, row.vehicle_kind,
        async () => { throw new Error('Precompute missed fixture'); }));
      const cached = base ? await overlayRoutes(base, row.vehicle_kind, at) : null;
      const full = await planRoutesLive('juan', row.target_id, 3, row.vehicle_kind, 'team', at);
      const selected = full?.routes.filter((r) => r.foldedUnder == null).map((r) => ({ ...r, foldedUnder: null }));
      const live = full && selected ? { ...full, routes: selected,
        topRoutes: selected.filter((r) => r.verdict === 'recommend'), graph: routeGraph(selected, full.targetId, true) } : null;
      identical &&= sameSnapshot(cached, live);
      difference ||= firstDifference(cached, live);
      dateCount += countDates(cached);
    }
    check('CACHE2 compact precompute equals visible live routes and full summary at the same evaluation time',
      counts.complete && counts.targets > 0 && counts.searches === counts.targets && persisted.length === counts.searches && identical,
      `${counts.searches} target/kind searches; routes, scores, folds, graph, restrictions and coverage compared. ${difference}`);
    check('CACHE persisted coverage, edge and influence dates revive as Dates', identical && dateCount > 0,
      `${dateCount} Date values survived the persisted-cache read and deep comparison.`);
    let fallback = 0;
    const emptySearch = await cachedRoutes(empty, 'fund', async () => { fallback++; return null; });
    check('CACHE a supported search with no routes is persisted and served without searching again',
      persisted.some((r) => r.target_id === empty && r.vehicle_kind === 'fund') && fallback === 0
        && emptySearch?.routes.length === 0,
      'The no-route result keeps its corpus disclosure and is a cache hit.');

    const missing = (await db.one<{ id: string }>('select gen_random_uuid()::text as id'))!.id;
    const absent = await planRoutes('juan', missing, 3, 'fund', 'team');
    check('CACHE an unknown target keeps the live empty-search behavior without a foreign-key failure',
      absent?.routes.length === 0 && !(await db.one('select target_id from network.route_cache where target_id = $1', [missing])),
      'Unknown target URLs retain coverage disclosure; no orphaned cache row is written.');

    const original = await db.one<{ computed: string; payload: string }>(
      "select computed_at::text as computed, search::text as payload from network.route_cache where target_id = $1 and vehicle_kind = 'fund'", [id('Solveig Quaresma')]);
    const stranger = (await db.one<{ id: string }>(`insert into identity.entity (entity_type, display_name)
      values ('person', 'Unrelated cache fixture') returning entity_id::text as id`))!.id;
    await db.query('update identity.entity set display_name = $2 where entity_id = $1', [stranger, 'Renamed unrelated cache fixture']);
    await db.query(`insert into identity.source_record (source, source_id, entity_id, resolved_by)
      values ('w3_person', 'cache2-unrelated-person', $1, 'fixture')`, [stranger]);
    await db.query("update platform.source_sync set detail = 'Fictional sync progress' where source = 'affinity'");
    await planRoutes('juan', id('Solveig Quaresma'), 3, 'fund', 'team');
    const unchanged = await db.one<{ computed: string; payload: string }>(
      "select computed_at::text as computed, search::text as payload from network.route_cache where target_id = $1 and vehicle_kind = 'fund'", [id('Solveig Quaresma')]);
    check('CACHE2 unrelated entity writes and sync progress reuse the existing target snapshot',
      original?.computed === unchanged?.computed && original?.payload === unchanged?.payload,
      'A changed graph read revision validates dependencies without recomputing unrelated targets.');
    await db.query('delete from identity.source_record where entity_id = $1', [stranger]);
    await db.query('delete from identity.entity where entity_id = $1', [stranger]);
    const { routeWarmupProgress } = await import('../../modules/network/cache');
    const progress = await routeWarmupProgress();
    check('CACHE2 warm-up progress is available as one cheap completed counter',
      progress.status === 'complete' && progress.completed === counts.searches && progress.total === counts.targets,
      'The progress row exposes completion and elapsed time without scanning cache payloads.');

    let attempts = 0, refused = false;
    const retry = () => cachedRoutes(id('Solveig Quaresma'), 'fixture-retry', async () => {
      attempts++;
      if (attempts === 1) throw new Error('Invented transient route lookup failure');
      return null;
    });
    try { await retry(); } catch { refused = true; }
    const recovered = await retry();
    check('CACHE a failed lookup is evicted so the next request can recover',
      refused && attempts === 2 && recovered === null, 'The rejected promise does not poison later requests.');

    // A new handle with the same revision must not inherit another database's in-memory hit.
    const g = globalThis as typeof globalThis & { __capitalOsDb?: Promise<import('../../lib/db').Db> };
    const previous = g.__capitalOsDb;
    const other: import('../../lib/db').Db = { kind: db.kind, query: db.query.bind(db), one: db.one.bind(db),
      exec: db.exec.bind(db), transaction: db.transaction.bind(db), close: async () => {} };
    try {
      g.__capitalOsDb = Promise.resolve(other);
      await retry();
      check('CACHE distinct database handles never share memory results, even at the same revision',
        attempts === 3, 'A second handle performs its own lookup instead of reusing the first null result.');
    } finally { g.__capitalOsDb = previous; }
  } finally {
    await db.query('delete from strategy.pursuit where entity_id = $1', [empty]);
    await db.query('delete from identity.entity where entity_id = $1', [empty]);
  }
}

export async function networkProperties({ check, id }: SeedContext) {
  const { planRoutes } = await import('../../modules/network');
  const roos = await planRoutes('juan', id('Solveig Quaresma'));
  const uncertain = roos!.routes.filter((r) => r.weakestTier >= 'C' && r.verdict !== 'excluded');
  check('C/D routes are available without review and carry uncertainty labels',
    uncertain.length > 0 && uncertain.every((r) => r.verdict !== 'not_a_route' && r.reasons.some((s) => s.includes('uncertainty'))),
    `${uncertain.length} routes with labelled uncertainty`);
  const informational = roos!.routes.filter((r) => r.verdict !== 'excluded');
  check('SCORE2 routes rank by explained investment strength with evidence confidence', informational.every((r, i) =>
    Boolean(r.score?.factors.some((f) => f.key === 'confidence'))
      && (i === 0 || informational[i - 1]!.verdict !== r.verdict || informational[i - 1]!.score!.value >= r.score!.value)),
    'Tier contributes uncertainty to the score; target relationship strength determines route ranking.');

  const restrictedPaths = roos!.routes.filter((r) => r.connectorNames.includes('Anselm Rautio'));
  check(
    'Every path through a restricted party is excluded',
    restrictedPaths.length > 0 && restrictedPaths.every((r) => r.verdict === 'excluded'),
    `${restrictedPaths.filter((r) => r.verdict === 'excluded').length} of ${restrictedPaths.length} excluded`,
  );

}

export async function networkVariations(check: Check) {
  const { planRoutes } = await import('../../modules/network');
  // ---------------------------------------------------------------- variations

  const variations: Array<{
    name: string;
    describe: string;
    perturb: (db: Awaited<ReturnType<typeof freshDb>>, ids: (n: string) => string) => Promise<void>;
    expect: string;
    assert: (routes: Awaited<ReturnType<typeof planRoutes>>) => { ok: boolean; detail: string };
  }> = [
    {
      name: 'remove the tier-A route',
      describe: 'Delete the Umeadi → Quaresma edge.',
      expect: 'The best remaining route is available with its original evidence tier and uncertainty.',
      perturb: async (d, ids) => {
        await d.query('delete from network.edge where from_entity = $1 and to_entity = $2', [
          ids('Orla Umeadi'), ids('Solveig Quaresma'),
        ]);
      },
      assert: (r) => {
        const best = r!.routes[0];
        return {
          ok: Boolean(best) && best!.verdict === 'recommend' && best!.weakestTier >= 'B',
          detail: `best verdict is ${best?.verdict ?? 'none'}`,
        };
      },
    },
    {
      name: 'add a blanket do-not-contact',
      describe: 'Record a blanket restriction on Quaresma.',
      expect: 'Every route is excluded. Not one is downgraded to Hold and left clickable.',
      perturb: async (d, ids) => {
        await d.query(
          `insert into coordination.restriction (entity_id, scope, instruction, source)
           values ($1, 'blanket', 'Quaresma asked not to be approached about any fund this year.', 'S05')`,
          [ids('Solveig Quaresma')],
        );
      },
      assert: (r) => ({
        ok: r!.routes.length > 0 && r!.routes.every((x) => x.verdict === 'excluded'),
        detail: `${r!.routes.filter((x) => x.verdict === 'excluded').length} of ${r!.routes.length} excluded`,
      }),
    },
    {
      name: 'a human reviews the tier-D edge',
      describe: 'Mark Barrowcliff → Quaresma as confirmed by a person.',
      expect:
        'It remains a route with tier D uncertainty; review does not gate or upgrade the evidence.',
      perturb: async (d, ids) => {
        const u = await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'");
        await d.query(
          `update network.edge set reviewed_by = $3, reviewed_at = now(),
                  review_note = 'Spoke to Barrowcliff; she knows Quaresma slightly.'
            where from_entity = $1 and to_entity = $2`,
          [ids('Mirela Barrowcliff'), ids('Solveig Quaresma'), u!.id],
        );
      },
      assert: (r) => {
        const path = r!.routes.find((x) => x.connectorNames.includes('Mirela Barrowcliff'));
        return {
          ok: path?.verdict === 'recommend' && path.weakestTier === 'D',
          detail: `Barrowcliff route is ${path?.verdict ?? 'missing'}`,
        };
      },
    },
    {
      name: 'the connector reaches the cap',
      describe: 'Record one more ask through Umeadi this quarter.',
      expect: 'The tier-A route drops from Recommend to Hold on goodwill, not on evidence.',
      perturb: async (d, ids) => {
        const u = await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'");
        const v = await d.one<{ id: string }>("select id from platform.vehicle where slug = 'rails'");
        await d.query(
          `insert into coordination.ask
             (entity_id, connector_id, vehicle_id, status, owner_id, purpose, made_at, channel)
           values ($1,$2,$3,'made',$4,'Another ask this quarter', now() - interval '2 days', 'email')`,
          [ids('Renata Corcoran'), ids('Orla Umeadi'), v!.id, u!.id],
        );
      },
      assert: (r) => {
        const path = r!.routes.find((x) => x.connectorNames.includes('Orla Umeadi'));
        return {
          ok: path?.verdict === 'hold',
          detail: `Umeadi route is ${path?.verdict ?? 'missing'}`,
        };
      },
    },
  ];
  for (const v of variations) {
    const d = await freshDb();
    const { listEntities: le } = await import('../../modules/identity');
    const { planRoutes: pr } = await import('../../modules/network');
    const ents = await le();
    const ids = (n: string) => ents.find((e) => e.displayName === n)!.entityId;
    // Warm the persisted/memory team search before changing evidence or action guards.
    await pr('juan', ids('Solveig Quaresma'), 3, 'fund', 'team');
    const before = await d.one<{ computed_at: string }>('select computed_at::text as computed_at from network.route_cache where target_id = $1 and vehicle_kind = $2', [ids('Solveig Quaresma'), 'fund']);
    await v.perturb(d, ids);
    const r = await pr('juan', ids('Solveig Quaresma'));
    const out = v.assert(r);
    check(`Variation — ${v.name}`, out.ok, `${v.expect} (${out.detail})`);
    const cached = await pr('juan', ids('Solveig Quaresma'), 3, 'fund', 'team');
    const evaluatedAt = cached?.routes[0]?.score?.evaluatedAt;
    const { planRoutesLive } = await import('../../modules/network');
    const live = await planRoutesLive('juan', ids('Solveig Quaresma'), 3, 'fund', 'team', evaluatedAt ? new Date(evaluatedAt) : new Date());
    const after = await d.one<{ computed_at: string }>('select computed_at::text as computed_at from network.route_cache where target_id = $1 and vehicle_kind = $2', [ids('Solveig Quaresma'), 'fund']);
    const { routeGraph } = await import('../../modules/network/service');
    const selected = live?.routes.filter((r) => r.foldedUnder == null).map((r) => ({ ...r, foldedUnder: null }));
    const expected = live && selected ? { ...live, routes: selected,
      topRoutes: selected.filter((r) => r.verdict === 'recommend'), graph: routeGraph(selected, live.targetId, true) } : null;
    const dynamic = v.name === 'add a blanket do-not-contact' || v.name === 'the connector reaches the cap';
    const rewrote = String(before?.computed_at) !== String(after?.computed_at);
    check(`CACHE2 applies changes between builds — ${v.name}`,
      (dynamic ? !rewrote : true) && sameSnapshot(cached, expected) && v.assert(cached).ok,
      'Current visible routes and full counts equal live search; action changes do not rewrite the structural snapshot.');
    await d.close();
  }
}

/** CONN2: invented fixtures only. Exercise W3 → JSONB graph build → guarded route search. */
export async function connectionsV2Properties(db: import('../../lib/db').Queryable, check: Check) {
  const nw = await import('../../modules/network');
  const cn = await import('../../lib/enrich/connect');
  const at = new Date('2026-09-26T12:00:00Z');
  const recent = '2026-09-01';
  const score = (kind: import('../../modules/network').WarmthKind) => nw.tieWarmth('other', {
    kind, lastInteraction: recent, investmentRelevant: true,
    jointInvestments: ['deal-a', 'deal-b', 'deal-c'].map((dealId) => ({ dealId, on: recent })),
  }, at).score;
  const ordered = ['acquaintance', 'worked_together', 'cofounder', 'frequent_coinvestment'] as const;
  check('CONN2 warmth orders acquaintance < joint work < co-founding < frequent personal co-investment',
    ordered.every((k, i) => i === 0 || score(k) > score(ordered[i - 1]!)), ordered.map((k) => `${k}: ${score(k)}`).join(', '));
  const duplicateDeals = nw.tieWarmth('coinvestor', { kind: 'frequent_coinvestment', investmentRelevant: true,
    jointInvestments: Array.from({ length: 3 }, () => ({ dealId: 'same-deal', on: recent })) }, at);
  const stale = nw.tieWarmth('colleague', { kind: 'worked_together', lastInteraction: '2010-01-01' }, at);
  const unknown = nw.tieWarmth('colleague', { kind: 'worked_together' }, at);
  const retrievedToday = nw.edgeWarmth({ kind: 'colleague', evidence: [{ note: 'Historical work, newly retrieved', as_of: recent,
    tie: { kind: 'worked_together', lastInteraction: '2010-01-01' } }] }, at);
  check('CONN2 recency uses contact dates; duplicate deal mentions cannot earn frequent co-investment',
    score('worked_together') > stale.score && stale.recency === 'historical' && unknown.recency === 'unknown'
      && duplicateDeals.kind === 'joint_investment' && retrievedToday.score === stale.score,
    'Historical and unknown remain labelled; retrieval cannot refresh contact; three mentions of one deal count once.');

  const edge = (id: string, kind: import('../../modules/network').WarmthKind): import('../../modules/network').Edge => ({
    edgeId: id, fromEntity: id.split('-')[0]!, toEntity: id.split('-')[1]!, fromName: 'Demo sender', toName: 'Demo recipient',
    kind: 'colleague', tier: 'B', strength: null, tieBand: null, evidence: [{ note: 'Invented joint work', tie: { kind, lastInteraction: recent } }],
    reviewedByName: null, reviewedAt: null, reviewNote: null, validFrom: at, validTo: null,
  });
  const route = (edges: import('../../modules/network').Edge[]): import('../../modules/network').Route => ({
    hops: edges.map((e) => ({ edge: e, toName: e.toName, toEntity: e.toEntity })), connectorIds: edges.slice(0, -1).map((e) => e.toEntity),
    connectorNames: [], verdict: 'recommend', reasons: ['Invented fixture'], weakestTier: 'B', askLoad: null, influence: null,
  });
  const first = edge('start-connector', 'cofounder'), final = edge('connector-target', 'worked_together');
  const short = route([first, final]);
  const longer = route([edge('start-detour', 'worked_together'), edge('detour-connector', 'worked_together'), final]);
  const folded = nw.foldRoutes([short, longer], at);
  const weak = nw.foldRoutes([route([edge('start-connector', 'acquaintance'), final]), longer], at);
  const held = nw.foldRoutes([{ ...short, verdict: 'hold' }, longer], at);
  const old = nw.foldRoutes([route([{ ...first, evidence: [{ note: 'Old joint work', tie: { kind: 'cofounder', lastInteraction: '2010-01-01' } }] }, final]), longer], at);
  check('CONN2 a redundant detour folds under a strong first hop and reappears when that hop is weak or action-held; age reduces warmth without a hard gate',
    folded.length === 2 && folded[1]?.foldedUnder === 0 && weak[1]?.foldedUnder === null
      && held[1]?.foldedUnder === null && old[1]?.foldedUnder === 0,
    'Both routes retained; only the redundant strong-prefix alternative folds.');
  const warmer = route([edge('start-detour', 'cofounder'), edge('detour-connector', 'cofounder'), final]);
  check('CONN2 a warmer detour stays visible; the route is no warmer than its weakest hop',
    nw.foldRoutes([route([edge('start-connector', 'worked_together'), final]), warmer], at)[1]?.foldedUnder === null
      && nw.routeWarmth(short, at) === score('worked_together'), 'A useful warmer prefix remains a separate option.');

  const person = (key: string, name: string): import('../../lib/enrich/candidates').Candidate => ({
    key, name, type: 'person', org: null, role: null, location: null, domains: [], enriched: {}, pursuits: [], notes: [], context: [], money: null, restrictions: [],
    contact: { since: null, earlier: { meetings: 0, first: null, last: null }, meetings: 0, lastTouch: null, lastFromThem: null,
      awaitingSince: null, read: null, lastTouchChannel: null, groupMeetings: 0, meetingDates: [], recent: [], outreachShared: 0 },
  });
  const team: import('../../lib/enrich/connect').TeamMember[] = [{ handle: 'conn2-founder', name: 'Morgan Alder',
    roles: [{ org: 'Protocol Labs', role: 'Founder', since: '2013-01-01', source: 'https://example.org/team' }], prior: [], education: [] }];
  const net: import('../../lib/enrich/connect').Network = { orgs: [{ name: 'Protocol Labs', aliases: ['Protocol Labs'], domains: ['lab.example'] }],
    backers: [], backer_people: [{ name: 'Ellis Stone', what: 'Angel investor in Protocol Labs', source: 'https://example.org/backers' }] };
  const founderUser = (await db.one<{ id: string }>(
    `insert into platform.app_user (handle, name, initials, role, email) values ('conn2-founder', 'Morgan Alder', 'MA', 'test', 'morgan@example.org') returning id`,
  ))!.id;
  const ids: string[] = [];
  for (const name of ['Ellis Stone', 'Avery Birch', 'Robin Linden']) ids.push((await db.one<{ id: string }>(
    `insert into identity.entity (entity_type, display_name) values ('person', $1) returning entity_id::text as id`, [name],
  ))!.id);
  let founderEntity: string | null = null;
  try {
    const angel = person(ids[0]!, 'Ellis Stone'), target = person(ids[1]!, 'Avery Birch');
    const colleague = { ...person(ids[2]!, 'Robin Linden'), domains: ['lab.example'] };
    const finding = (p: typeof angel): import('../../lib/enrich/schema').Finding => ({ key: p.key, name: p.name,
      researched: { at: '2026-09-26', by: 'fixture', workflow: 'W1', version: '1' }, identity: { match: 'confirmed', basis: 'Invented identity' }, facts: [] });
    const tf = { ...finding(target), connections: [{ to: angel.name, kind: 'colleague' as const, tier: 'B' as const,
      reviewedBy: team[0]!.handle, reviewedAt: new Date().toISOString(),
      basis: 'They co-founded an invented business together', source: 'https://example.org/history',
      tie: { kind: 'cofounder' as const, lastInteraction: new Date().toISOString().slice(0, 10) } }] };
    const cf = { ...finding(colleague), facts: [{ field: 'prior_role' as const, value: 'Engineer at Protocol Labs', confidence: 'high' as const,
      detail: { company: 'Protocol Labs', from: '2014-01-01', until: '2023-01-01' }, source: { kind: 'primary' as const, url: 'https://example.org/career' } }] };
    const inputs = [angel, target, colleague], findings = new Map<string, import('../../lib/enrich/schema').Finding>([[target.key, tf], [colleague.key, cf]]);
    const joined = cn.connectionPaths(inputs, findings, net, team, [], at).paths;
    check('CONN2 a personal PL angel is directly tied to its founder; dated long service reaches overlapping colleagues',
      joined.some((p) => p.lp === angel.key && p.other.handle === team[0]!.handle && p.tier === 'B'
        && p.tie?.kind === 'investor_founder' && p.tie.withUs === 'investor')
        && joined.some((p) => p.lp === colleague.key && p.other.handle === team[0]!.handle && p.tier === 'B' && p.tie?.kind === 'worked_together'),
      'General rules use the backer roster, own employment anchor and sourced overlapping dates.');
    check('SCORE2 one team roster person remains a source when also present in LP inputs',
      cn.resolvePerson(team[0]!.name, [person('invented-team-duplicate', team[0]!.name)], team)?.type === 'team'
        && cn.resolvePerson(team[0]!.name, [person('invented-team-duplicate', team[0]!.name)], team)?.handle === team[0]!.handle,
      'The duplicate LP entry does not create a second connector identity for the team member.');
    const laterTeam = [{ ...team[0]!, roles: [{ ...team[0]!.roles[0]!, since: '2024-01-01' }] }];
    const noOverlap = cn.connectionPaths(inputs, findings, net, laterTeam, [], at).paths;
    const ambiguous = cn.connectionPaths(inputs, new Map([[target.key, { ...tf, identity: { match: 'ambiguous', basis: 'Namesake' } }]]), net, team, [], at).paths;
    check('PL affiliation needs no dated overlap; unresolved public identities and duplicate names remain distinct',
      noOverlap.some((p) => p.lp === colleague.key && p.tier === 'B' && p.tie?.basis === 'pl_affiliation')
        && !ambiguous.some((p) => p.lp === target.key && p.other.key === angel.key)
        && cn.resolvePerson(angel.name, [angel, { ...angel, key: 'duplicate' }], team) === null,
      'PL affiliation is sufficient; identity resolution still avoids conflating namesakes.');
    for (const p of inputs) await db.query(`insert into research.note (entity_id, kind, body, data) values ($1, 'connection_candidates', 'Invented connections', $2)`,
      [p.key, JSON.stringify({ paths: joined.filter((path) => path.lp === p.key).map((path) => path.other.key === angel.key ? { ...path, other: { type: 'ours', name: `${angel.name} (sourced personal backer)` } } : path) })]);
    await nw.buildNetwork();
    founderEntity = (await nw.entityForUser(team[0]!.handle))!.entityId;
    const direct = await nw.planRoutes(team[0]!.handle, angel.key);
    const promoted = await nw.planRoutes(team[0]!.handle, target.key);
    check('CONN2 a warm near-them contact becomes a guarded graph route after W3 import/build',
      Boolean(direct?.routes.some((r) => r.verdict === 'recommend' && r.hops.length === 1))
        && Boolean(promoted?.routes.some((r) => r.verdict === 'recommend' && r.connectorIds.includes(angel.key)
          && r.hops.some((h) => nw.edgeWarmth(h.edge).kind === 'cofounder' && h.edge.reviewedByName === team[0]!.name && Boolean(h.edge.reviewedAt)))),
      'Named endpoints and warmth survive JSONB; the investor is a direct hop and carries the onward route.');
    for (const tier of ['C', 'D']) {
      await db.query(`update network.edge set tier = $1::network.evidence_tier, reviewed_by = null, reviewed_at = null where from_entity = $2 and to_entity = $3`, [tier, angel.key, target.key]);
      const blocked = await nw.planRoutes(team[0]!.handle, target.key);
      await db.query(`update network.edge set reviewed_by = $1, reviewed_at = now() where from_entity = $2 and to_entity = $3`, [founderUser, angel.key, target.key]);
      const reviewed = await nw.planRoutes(team[0]!.handle, target.key);
      check(`PLRULE tier ${tier} routes with uncertainty, independently of human review`,
        Boolean(blocked?.routes.length && blocked.routes.every((r) => r.verdict === 'recommend' && r.reasons.some((s) => s.includes('uncertainty'))))
          && Boolean(reviewed?.routes.length && reviewed.routes.every((r) => r.verdict === 'recommend' && r.reasons.some((s) => s.includes('uncertainty')))),
        'Review status does not gate or rank information; the C/D label is retained.');
    }
    // WGRAPH: deterministic warehouse hops survive W3, JSONB and the guarded route planner.
    const warehouseTargetId = (await db.one<{ id: string }>(
      `insert into identity.entity (entity_type, display_name) values ('person', 'Terry Willow') returning entity_id::text as id`))!.id;
    ids.push(warehouseTargetId);
    const warehouseTarget = person(warehouseTargetId, 'Terry Willow');
    const wp = (key: string, name: string): import('../../lib/enrich/warehouse-graph').WarehousePerson => ({
      key, name, org: 'Invented Ventures', emailDomain: 'example.org', roles: [], warehouseIds: { fixture: key },
      source: 'invented.members', as_of: recent, confidence: 'high', last_verified_by: 'invented fixture',
    });
    const graph: import('../../lib/enrich/connect').WarehouseGraph = {
      people: [{ ...wp('w-team', team[0]!.name), teamKey: team[0]!.handle }, wp('w-via', 'Dana Hawthorn'), wp('w-target', warehouseTarget.name)],
      ties: [
        { key: 'w-first', from: 'w-team', to: 'w-via', kind: 'repeated_contact', tier: 'B', firstSeen: recent, lastSeen: recent, source: 'invented.communications', rowIds: ['r1', 'r2'], count: 2 },
        { key: 'w-last', from: 'w-via', to: 'w-target', kind: 'joint_investment', tier: 'B', firstSeen: recent, lastSeen: recent, source: 'invented.investments', rowIds: ['d1'], count: 1 },
      ],
      matches: [{ lpKey: warehouseTargetId, personKey: 'w-target', score: 1, status: 'confident', basis: ['name and organization'] }],
    };
    const wg = await import('../../lib/enrich/warehouse-graph');
    check('WGRAPH evidence assigns tiers independently of volume or warmth',
      wg.classifyWarehouseTie('direct_contact', 1).tier === 'B'
        && wg.classifyWarehouseTie('direct_contact', 5).kind === 'repeated_contact'
        && wg.classifyWarehouseTie('named_coinvestment', 4).tier === 'B'
        && ['shared_company', 'cofounders', 'portfolio'].every((e) => wg.classifyWarehouseTie(e as 'shared_company', 500).tier === 'C')
        && ['event', 'demo_interest'].every((e) => wg.classifyWarehouseTie(e as 'event', 500).tier === 'D'),
      'Repeated shared affiliations and event attendance never become evidence of personal contact.');
    const matchInput = [{ key: 'invented-lp', name: 'Avery Rowan', org: 'Invented Ventures', domains: ['example.org'] }];
    const matchPeople = [wp('identity-a', 'Avery Rowan'), { ...wp('identity-b', 'Avery Rowan'), org: 'Other Organization', emailDomain: null }];
    const resolved = wg.matchWarehousePeople(matchInput, matchPeople);
    const collision = wg.matchWarehousePeople(matchInput, [matchPeople[0]!, { ...matchPeople[0]!, key: 'identity-copy' }]);
    check('WGRAPH identity matching requires name and organization or work domain; collisions stay separate',
      resolved.length === 2 && resolved.filter((m) => m.status === 'confident').length === 1
        && resolved.find((m) => m.personKey === 'identity-b')?.status === 'ambiguous'
        && collision.length === 2 && collision.every((m) => m.status === 'ambiguous'),
      'Namesake-only rows and equally supported alternatives remain distinct records.');
    const suffixOnly = wg.matchWarehousePeople([{ ...matchInput[0]!, org: 'LLC', domains: [] }],
      [{ ...matchPeople[0]!, org: 'Inc.', emailDomain: null }]);
    const reverseCollision = wg.matchWarehousePeople([matchInput[0]!, { ...matchInput[0]!, key: 'second-lp-record' }], [matchPeople[0]!]);
    check('WGRAPH empty organization normalization cannot corroborate a namesake',
      suffixOnly.length === 1 && suffixOnly[0]?.status === 'ambiguous' && !suffixOnly[0]?.basis.includes('organization'),
      'Legal suffixes alone carry no organization identity.');
    check('WGRAPH the matcher keeps reverse collisions separate and ambiguous',
      reverseCollision.length === 2 && reverseCollision.every((m) => m.status === 'ambiguous')
        && new Set(reverseCollision.map((m) => m.lpKey)).size === 2,
      'Two LP records cannot both own one confidently resolved warehouse person.');
    const redacted = wg.redactWarehouseText('Avery Rowan <avery.rowan+demo@example.org>; CASEY@SUB.EXAMPLE.NET');
    check('WGRAPH free-text email addresses are removed while domain-only evidence survives',
      !redacted.includes('@') && redacted.includes('Avery Rowan') && redacted.split('[address removed]').length === 3
        && wg.redactWarehouseText('example.org') === 'example.org',
      'Invented embedded addresses, uppercase and plus-addressing are scrubbed from exported text.');
    const warmthConfig = (await import('../../config/deployment')).config.routeWarmth;
    check('WGRAPH repeated contact uses the configured threshold',
      wg.classifyWarehouseTie('direct_contact', warmthConfig.repeatedContacts - 1).kind === 'acquaintance'
        && wg.classifyWarehouseTie('direct_contact', warmthConfig.repeatedContacts).kind === 'repeated_contact',
      'The extractor and route warmth share one configured boundary.');
    const warehouseJoin = () => cn.connectionPaths([warehouseTarget], new Map(), { orgs: [], backers: [], backer_people: [] }, team, [], at, graph).paths;
    const joinedWarehouse = warehouseJoin();
    check('WGRAPH two joins produce a named intermediary with pairwise provenance',
      joinedWarehouse.length === 1 && joinedWarehouse[0]?.warehouse?.people[1]?.key === 'w-via'
        && joinedWarehouse[0]?.warehouse?.ties.length === 2 && joinedWarehouse[0]?.tier === 'B',
      'The W3 path retains both people and both source-row sets.');
    const directWarehouse = cn.warehousePaths([warehouseTarget], team, { ...graph,
      ties: [{ ...graph.ties[0]!, to: 'w-target' }] });
    check('WGRAPH named direct interactions remain one-hop routes',
      directWarehouse.length === 1 && directWarehouse[0]?.warehouse?.ties.length === 1 && directWarehouse[0]?.tier === 'B',
      'A named team-to-LP interaction needs no intermediary.');
    const ambiguousGraph = { ...graph, matches: [
      { ...graph.matches[0]!, status: 'ambiguous' as const },
      { ...graph.matches[0]!, personKey: 'w-via', status: 'ambiguous' as const },
    ] };
    check('WGRAPH ambiguous alternatives and duplicate confident matches never merge',
      cn.warehousePaths([warehouseTarget], team, ambiguousGraph).length === 0
        && cn.warehousePaths([warehouseTarget], team, { ...graph, matches: [graph.matches[0]!, { ...graph.matches[0]!, personKey: 'w-via' }] }).length === 0,
      'Separate matches stay separate; neither produces a graph route.');
    check('WGRAPH one corroborated match can route while its name-only alternatives stay separate',
      cn.warehousePaths([warehouseTarget], team, { ...graph, matches: [graph.matches[0]!, { ...graph.matches[0]!, personKey: 'w-via', status: 'ambiguous' }] }).length === 1,
      'Only the unique confident identity becomes the endpoint.');
    check('WGRAPH one warehouse identity cannot confer routes on two LP records',
      cn.warehousePaths([warehouseTarget, { ...warehouseTarget, key: 'duplicate-lp' }], team, { ...graph,
        matches: [graph.matches[0]!, { ...graph.matches[0]!, lpKey: 'duplicate-lp' }] }).length === 0
        && cn.warehousePaths([warehouseTarget], team, { ...graph, matches: [graph.matches[0]!,
          { ...graph.matches[0]!, lpKey: 'conflict-a', personKey: 'w-via' },
          { ...graph.matches[0]!, lpKey: 'conflict-b', personKey: 'w-via' }] }).length === 0,
      'Reverse collisions are suppressed before W3 counts or materializes routes.');
    const graphFs = await import('node:fs/promises');
    const graphOs = await import('node:os');
    const graphCrypto = await import('node:crypto');
    const graphFixture = await graphFs.mkdtemp(join(graphOs.tmpdir(), 'wgraph-fixture-'));
    try {
      const absent = await cn.readWarehouseGraph(graphFixture);
      check('WGRAPH an entirely absent extraction remains optional',
        absent.people.length === 0 && absent.ties.length === 0 && absent.matches.length === 0, 'Old research folders still work.');
      const fixtureDir = join(graphFixture, 'warehouse');
      await graphFs.mkdir(fixtureDir);
      const files = Object.fromEntries(['people', 'ties', 'matches'].map((k) => [
        `${k}.jsonl`, graph[k as keyof typeof graph].map((row) => JSON.stringify(row)).join('\n') + '\n',
      ]));
      const manifest = { files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, graphCrypto.createHash('sha256').update(content).digest('hex')])) };
      const refuses = async () => { try { await cn.readWarehouseGraph(graphFixture); return false; } catch { return true; } };
      await graphFs.writeFile(join(fixtureDir, 'people.jsonl'), files['people.jsonl']!);
      const partial = await refuses();
      for (const [name, content] of Object.entries(files)) await graphFs.writeFile(join(fixtureDir, name), content);
      const unmanifested = await refuses();
      await graphFs.writeFile(join(fixtureDir, 'graph-manifest.json'), JSON.stringify(manifest));
      const complete = await cn.readWarehouseGraph(graphFixture);
      await graphFs.writeFile(join(fixtureDir, 'matches.jsonl'), files['matches.jsonl']! + '\n');
      const mismatched = await refuses();
      await graphFs.writeFile(join(fixtureDir, 'matches.jsonl'), files['matches.jsonl']!);
      await graphFs.rm(join(fixtureDir, 'ties.jsonl'));
      const missing = await refuses();
      check('WGRAPH partial, unmanifested and mixed-generation graph files fail closed',
        partial && unmanifested && mismatched && missing && complete.people.length === graph.people.length
          && complete.ties.length === graph.ties.length && complete.matches.length === graph.matches.length,
        'Only all three JSONL files with matching SHA-256 hashes may create routes.');
    } finally { await graphFs.rm(graphFixture, { recursive: true, force: true }); }
    check('WGRAPH target restrictions remove every warehouse approach',
      cn.warehousePaths([{ ...warehouseTarget, restrictions: [{ scope: 'blanket', connector: null, channel: null }] }], team, graph).length === 0,
      'A new intermediary cannot circumvent a blanket restriction.');
    const writeWarehousePaths = async () => {
      await db.query(`delete from research.note where entity_id = $1 and kind = 'connection_candidates'`, [warehouseTargetId]);
      await db.query(`insert into research.note (entity_id, kind, body, data) values ($1, 'connection_candidates', 'Invented warehouse connections', $2)`,
        [warehouseTargetId, JSON.stringify({ paths: warehouseJoin() })]);
      await nw.buildNetwork();
    };
    await writeWarehousePaths();
    const warehouseEntity = (await db.one<{ id: string }>(`select entity_id::text as id from identity.source_record where source = 'warehouse' and source_id = 'w-via'`))!.id;
    ids.push(warehouseEntity);
    const warehouseRoutes = await nw.planRoutes(team[0]!.handle, warehouseTargetId);
    check('WGRAPH guarded route search traverses a warehouse person without inventing a direct shortcut',
      Boolean(warehouseRoutes?.routes.some((r) => r.hops.length === 2 && r.connectorIds.includes(warehouseEntity) && r.verdict === 'recommend'))
        && !warehouseRoutes?.routes.some((r) => r.hops.length === 1),
      'The intermediate identity and the two distinct evidence records survive import/build.');
    for (const tier of ['C', 'D'] as const) {
      graph.ties[1] = { ...graph.ties[1]!, tier, kind: 'proximity' };
      await writeWarehousePaths();
      const heldWarehouse = await nw.planRoutes(team[0]!.handle, warehouseTargetId);
      check(`WGRAPH a ${tier} tie routes with its uncertainty labelled, never gated on a person (rule 6)`,
        warehouseJoin()[0]?.tier === tier && Boolean(heldWarehouse?.routes.length)
          && heldWarehouse!.routes.some((r) => r.verdict === 'recommend' && r.reasons.some((x) => x.includes(`tier ${tier}`))),
        'Weak evidence ranks lower and says what it rests on (AGENTS.md rule 6, Juan 26 Sep).');
    }
    const policyGraph = { ...graph, people: graph.people.map((p) => p.key === 'w-via' ? { ...p, oneHop: true } : p), ties: [graph.ties[1]!] };
    const policy = cn.warehousePaths([warehouseTarget], team, policyGraph);
    check('WGRAPH the one-hop founder rule is explicit C proximity, never a fabricated interaction',
      policy.length === 1 && policy[0]?.warehouse?.ties[0]?.tier === 'C' && policy[0]?.warehouse?.ties[0]?.kind === 'proximity',
      'Policy access supplies a reviewable candidate hop.');
  } finally {
    const all = [...ids, ...(founderEntity ? [founderEntity] : [])];
    await db.query('delete from network.edge where from_entity = any($1::uuid[]) or to_entity = any($1::uuid[])', [all]);
    await db.query('delete from research.note where entity_id = any($1::uuid[])', [all]);
    await db.query('delete from identity.source_record where entity_id = any($1::uuid[])', [all]);
    await db.query('delete from identity.entity where entity_id = any($1::uuid[])', [all]);
    await db.query('delete from platform.app_user where id = $1', [founderUser]);
  }
}
