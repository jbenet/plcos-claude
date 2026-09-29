import type { Db } from '../lib/db';
import { edgeCoverage, enumeratePathsFromSources, tierCounts } from '../modules/network';

type Check = (name: string, ok: boolean, detail: string) => void;
const uuid = (n: number) => `fefefefe-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
type Path = { nodes: string[]; edges: string[]; hops: number };
type Link = { a: string; b: string; id: string; expired?: boolean };

/** An independent exhaustive oracle on invented small graphs, not the production SQL. */
function reference(links: Link[], sources: string[], target: string, pl: string, max: number): Path[] {
  const adjacency = links.filter((l) => !l.expired).flatMap((l) => [l, { ...l, a: l.b, b: l.a }]);
  return sources.flatMap((source) => {
    const paths: Path[] = [];
    function walk(nodes: string[], edges: string[]) {
      if (edges.length && nodes.at(-1) === target) { paths.push({ nodes, edges, hops: edges.length }); return; }
      if (edges.length >= max) return;
      for (const l of adjacency.filter((l) => l.a === nodes.at(-1))) {
        if (nodes.includes(l.b) || (l.b === pl && l.b !== target)) continue;
        walk([...nodes, l.b], [...edges, l.id]);
      }
    }
    walk([source], []);
    return paths.sort((a, b) => a.hops - b.hops || a.edges.join().localeCompare(b.edges.join())).slice(0, 300);
  });
}

export async function routesPerfProperties(check: Check, db: Db) {
  const ids = Array.from({ length: 48 }, (_, i) => uuid(i + 1));
  const [s1, s2, pl, target] = ids as [string, string, string, string, ...string[]];
  const links: Link[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if ((i * 17 + j * 11) % 4 === 0) continue;
    links.push({ a: ids[i]!, b: ids[j]!, id: uuid(100 + links.length), expired: (i + j) % 9 === 0 });
  }
  // Parallel evidence remains distinct, weak and unreviewed edges remain routable.
  links.push({ a: s1, b: target, id: uuid(9000) });
  const before = await edgeCoverage();
  try {
    await db.query(`insert into identity.entity (entity_id, entity_type, display_name)
      select id, 'person', 'Perf fixture' from unnest($1::uuid[]) id`, [ids]);
    await db.query(`update identity.entity set entity_type = 'org', display_name = 'PL' where entity_id = $1`, [pl]);
    await db.query(`insert into identity.source_record (source, source_id, entity_id, resolved_by)
      values ('w3_person', 'perf-fixture-pl', $1, 'perf-fixture')`, [pl]);
    for (const [i, l] of links.entries()) await db.query(`insert into network.edge
      (edge_id, from_entity, to_entity, kind, tier, valid_from, valid_to)
      values ($1, $2, $3, 'colleague', $4::network.evidence_tier, current_date - 30,
        case when $5 then current_date - 1 else null end)`, [l.id, l.a, l.b, ['A', 'B', 'C', 'D'][i % 4], Boolean(l.expired)]);
    for (const max of [1, 2, 3]) {
      const sources = [s1, s2, pl];
      const expected = reference(links, sources, target, pl, max);
      const actual = await enumeratePathsFromSources(sources, target, max);
      if (max === 3) check('PERF dense fixture reaches each source’s cap', expected.length === 900,
        'The independent oracle checks exact retained candidates at the 300-path boundary.');
      check(`PERF multi-source paths equal exhaustive oracle at ${max} hops`,
        JSON.stringify(actual) === JSON.stringify(expected),
        'Same ordering, cap, reverse edges, parallel evidence, expiry and PL-only-at-source rule.');
    }
    const added = await edgeCoverage();
    check('PERF cached coverage invalidates on insertion', added.edges === before.edges + links.length, 'A warmed cache sees new edges.');
    const tiersBefore = await tierCounts();
    await db.query(`update network.edge set tier = 'D' where edge_id = $1`, [links[0]!.id]);
    const tiersAfter = await tierCounts();
    check('PERF cached tier counts invalidate on review edits',
      tiersAfter.find((t) => t.tier === 'D')!.n === (tiersBefore.find((t) => t.tier === 'D')?.n ?? 0) + 1,
      'A metadata update changes the revision, even without a network rebuild.');
  } finally {
    await db.query(`delete from network.edge where from_entity = any($1::uuid[])`, [ids]);
    await db.query(`delete from identity.source_record where entity_id = any($1::uuid[])`, [ids]);
    await db.query('delete from identity.possible_match where left_entity= any($1::uuid[]) or right_entity= any($1::uuid[])', [ids]);
    await db.query("delete from research.note where entity_id= any($1::uuid[]) and kind='identity_creation'", [ids]);
    await db.query(`delete from identity.entity where entity_id = any($1::uuid[])`, [ids]);
  }
  check('PERF cached coverage invalidates on deletion', (await edgeCoverage()).edges === before.edges, 'Deleted fixture edges disappear immediately.');

  // 30K leaves, eight sources and a hub: 270K edges. Each source has 30K
  // three-hop candidates. A separate disconnected target tests empty hub searches.
  const count = 30_000;
  const base = 1_000_000;
  const sources = Array.from({ length: 8 }, (_, i) => uuid(base + i));
  const hub = uuid(base + 8), target2 = uuid(base + 9), isolated = uuid(base + 10);
  const leaves = Array.from({ length: count }, (_, i) => uuid(base + 11 + i));
  const all = [...sources, hub, target2, isolated, ...leaves];
  try {
    await db.query(`insert into identity.entity (entity_id, entity_type, display_name)
      select id, 'person', 'Generated performance fixture' from unnest($1::uuid[]) id`, [all]);
    await db.query(`insert into network.edge (from_entity, to_entity, kind, tier, valid_from)
      select a, b, 'colleague', 'C', current_date from unnest($1::uuid[]) a cross join unnest($2::uuid[]) b`,
    [[...sources, hub], leaves]);
    await db.query(`insert into network.edge (from_entity, to_entity, kind, tier, valid_from)
      values ($1, $2, 'colleague', 'B', current_date)`, [hub, target2]);
    await db.exec('analyze network.edge; analyze identity.entity');
    await enumeratePathsFromSources(sources, target2); // warm
    const start = performance.now();
    const routes = await enumeratePathsFromSources(sources, target2);
    const empty = await enumeratePathsFromSources([...sources, hub], isolated);
    const elapsed = performance.now() - start;
    check('PERF large hub graph stays bounded, including an empty search',
      routes.length === 8 * 300 && empty.length === 0 && elapsed < 3000,
      `${count} leaves / 270001 edges; ${routes.length} candidates; warm search plus empty search ${Math.round(elapsed)} ms (limit 3000 ms).`);
    check('PERF the cap is per source and ordered before ranking', sources.every((source) =>
      routes.filter((p) => p.nodes[0] === source).length === 300), 'No source consumes another source’s candidate budget.');
  } finally {
    await db.query(`delete from network.edge where from_entity = any($1::uuid[])`, [[...sources, hub]]);
    await db.query('delete from identity.possible_match where left_entity= any($1::uuid[]) or right_entity= any($1::uuid[])', [all]);
    await db.query("delete from research.note where entity_id= any($1::uuid[]) and kind='identity_creation'", [all]);
    await db.query(`delete from identity.entity where entity_id = any($1::uuid[])`, [all]);
    await db.exec('analyze network.edge; analyze identity.entity');
  }
}
