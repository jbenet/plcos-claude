import { isDeepStrictEqual } from 'node:util';
import { pathsFromSnapshot, type GraphSnapshot, type Link } from '../../modules/network/path-search';
import type { RawPath } from '../../modules/network/repo';
import type { Check } from './harness';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTestDb } from './database';
import { migrate } from '../../lib/db/migrate';
import { withDb } from '../../lib/db';
import { config } from '../../config/deployment';
import { buildNetwork } from '../../modules/network/build';
import { tieWarmth } from '../../modules/network/warmth';
import { generateNetworkFixture } from '../network-perf';

// Original source-side walk, kept as an independent reference for ordering and caps.
function oldPaths(graph: GraphSnapshot, sources: string[], target: string, hops: number, sourceOnly: Set<string>) {
  const paths: RawPath[] = [];
  for (const source of new Set(sources)) {
    const found: RawPath[] = [], first = graph.adjacency.get(source) ?? [];
    for (const a of first) if (a.other === target) found.push({ nodes: [source, target], edges: [a.edgeId], hops: 1 });
    if (hops >= 2) for (const a of first) {
      if (a.other === source || sourceOnly.has(a.other)) continue;
      for (const b of graph.adjacency.get(a.other) ?? []) if (b.other === target)
        found.push({ nodes: [source, a.other, target], edges: [a.edgeId, b.edgeId], hops: 2 });
    }
    if (hops >= 3) for (const a of first) {
      if (a.other === source || a.other === target || sourceOnly.has(a.other)) continue;
      for (const b of graph.adjacency.get(a.other) ?? []) {
        if (b.other === source || b.other === a.other || sourceOnly.has(b.other)) continue;
        for (const c of graph.adjacency.get(b.other) ?? []) if (c.other === target)
          found.push({ nodes: [source, a.other, b.other, target], edges: [a.edgeId, b.edgeId, c.edgeId], hops: 3 });
      }
    }
    paths.push(...found.slice(0, 300));
  }
  return paths;
}

export async function networkSpeedProperties(check: Check) {
  let seed = 1701, matches = true, capped = false;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let run = 0; run < 12; run++) {
    const adjacency = new Map<string, Link[]>();
    // Dense multigraphs exercise parallel ties, cycles, no-route and >300 paths.
    for (let i = 0; i < 200; i++) {
      const a = String(random() % 17), b = String(random() % 17);
      if (a === b) continue;
      const edgeId = String(i).padStart(5, '0');
      for (const [node, other] of [[a, b], [b, a]]) {
        const links = adjacency.get(node!) ?? [];
        links.push({ edgeId, other: other! }); adjacency.set(node!, links);
      }
    }
    const graph: GraphSnapshot = { adjacency, coverage: { edges: 200, from: null, to: null }, tiers: [] };
    for (const target of ['3', '16', 'absent']) for (const hops of [1, 2, 3]) for (const only of [[], ['0', '1', '2']]) {
      const sources = ['0', '1', '0', target], sourceOnly = new Set(only.length ? [...only, target] : []);
      const expected = oldPaths(graph, sources, target, hops, sourceOnly);
      matches &&= isDeepStrictEqual(await pathsFromSnapshot(graph, sources, target, hops, sourceOnly), expected);
      capped ||= expected.filter(p => p.nodes[0] === '0').length === 300;
    }
  }
  check('NETWORK target-side join preserves every old path, edge, order and per-source cap', matches && capped,
    '216 seeded cases include parallel ties, cycles, source-only exclusions, absent targets and the 300-path cap.');

  const dir = await mkdtemp(join(tmpdir(), 'network-speed-props-')), previous = process.env.ENRICH_DIR;
  const db = await openTestDb(join(dir, 'db'));
  process.env.ENRICH_DIR = join(dir, 'enrich');
  try {
    await migrate(db); await generateNetworkFixture(db, process.env.ENRICH_DIR, true);
    await db.exec(`update meetings.meeting set held_on='2025-12-31' where source_ref='fixture-0'`);
    const records = await db.query<{ a: string; b: string; on: string; channel: string }>(`select s.entity_id::text a,m.entity_id::text b,m.held_on::text "on",m.channel::text
      from meetings.meeting m join platform.app_user u on u.id=m.owner_id join identity.source_record s on s.source='app_user' and s.source_id=u.handle`);
    const groups = new Map<string, typeof records>();
    for (const r of records) { const key = `${r.a}|${r.b}`, rows = groups.get(key) ?? []; rows.push(r); groups.set(key, rows); }
    // Original record-edge calculation, including the old per-date formatter.
    const expected = [...groups.values()].map(rows => {
      const meetings = rows.filter(r => r.channel === 'meeting').map(r => r.on).sort();
      const dates = meetings.length ? meetings : rows.map(r => r.on).sort(), met = meetings.length > 0;
      const all = rows.map(r => r.on).sort(), repeated = new Set(all).size >= config.routeWarmth.repeatedContacts;
      const tie = { kind: repeated ? 'repeated_contact' as const : 'acquaintance' as const, lastInteraction: all.at(-1)! };
      const d = (x: string, year: boolean) => new Date(`${x}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
      const span = dates[0] === dates.at(-1) ? `on ${d(dates[0]!, true)}` : `${d(dates[0]!, dates[0]!.slice(0, 4) !== dates.at(-1)!.slice(0, 4))} to ${d(dates.at(-1)!, true)}`;
      const n = met ? new Set(dates).size : dates.length;
      return [rows[0]!.a, rows[0]!.b, met ? 'met' : 'corresponded', met ? 'A' : 'B',
        met ? tieWarmth('met', tie).score >= config.routeWarmth.strongFirstHop ? 'strong' : 'moderate' : repeated ? 'moderate' : 'weak',
        [{ derived: 'records', tie, note: met ? `${n} ${n === 1 ? 'meeting' : 'meetings'} held one to one, ${span}` : `${n} ${n === 1 ? 'message' : 'messages'} from them, ${span}`,
          source: met ? 'Affinity calendar and notes, as translated' : 'Affinity mail sync, as translated', as_of: new Date().toISOString().slice(0, 10) }], dates[0], null, null, null, null];
    });
    await withDb(db, () => buildNetwork({ awaitBackground: true }));
    const actual = (await db.query<{ edge: unknown[] }>(`select jsonb_build_array(from_entity,to_entity,kind,tier,tie_band,evidence,valid_from,valid_to,reviewed_by,reviewed_at,review_note) edge
      from network.edge where evidence @> '[{"derived":"records"}]'::jsonb`)).map(r => r.edge);
    const sort = (rows: unknown[][]) => rows.sort((a, b) => String(a.slice(0, 2)).localeCompare(String(b.slice(0, 2))));
    check('NETWORK optimized build produces exactly the original record ties and evidence', isDeepStrictEqual(sort(actual), sort(expected)),
      `${expected.length} invented ties; complete semantic edge rows, including duplicate dates, single dates and spans crossing years.`);
  } finally {
    await db.close(); await rm(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.ENRICH_DIR; else process.env.ENRICH_DIR = previous;
  }
}
