/** W3 files every row under its LP's canonical key. Invented fixtures only, no real records. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectionPaths, findPaths, type Path, type TeamMember } from '../../lib/enrich/connect';
import { pathProblems, isEntityKey } from '../../lib/enrich/connection-check';
import type { Candidate } from '../../lib/enrich/candidates';
import type { Connection, Finding } from '../../lib/enrich/schema';
import type { Check } from './harness';

const person = (key: string, name: string): Candidate => ({ key, name, type: 'person', org: null, role: null,
  location: null, domains: [], enriched: {}, pursuits: [], notes: [], context: [], money: null, restrictions: [],
  contact: { since: null, earlier: { meetings: 0, first: null, last: null }, meetings: 0, lastTouch: null,
    lastFromThem: null, awaitingSince: null, read: null, lastTouchChannel: null, groupMeetings: 0,
    meetingDates: [], recent: [], outreachShared: 0 } });
const finding = (key: string, name: string, at: string, connections: Connection[], extra: Partial<Finding> = {}): Finding => ({
  key, name, identity: { match: 'confirmed', basis: 'Invented identity', canonical: { name } },
  researched: { at, by: 'fixture', workflow: 'W1', version: '1' }, facts: [], connections, ...extra } as Finding);
const tie = (to: string, tier: Connection['tier'], basis: string): Connection =>
  ({ to, toType: 'person', scope: 'person', kind: 'other', tier, basis, source: 'https://example.org/invented' } as Connection);
const uuid = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Small seeded generator, so a failure names a case that can be run again. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export async function w3AliasKeyProperties(check: Check) {
  const at = new Date('2026-10-01T00:00:00Z');
  const net = { orgs: [], backers: [], backer_people: [] };
  const team: TeamMember[] = [{ handle: 'invented-rowan', name: 'Invented Rowan Vale', roles: [], prior: [], education: [] }];
  const lp = person(uuid(1), 'Invented Mira Willow');
  const contact = person(uuid(2), 'Invented Ash Branch');
  const firm: Candidate = { ...person(uuid(3), 'Invented Orchard Capital'), type: 'org', contacts: [{ ...contact, contactRole: 'Partner' }] };
  const alias = 'invented-research-mira';
  const mergedKey = uuid(90); // a person's key before a merge: in no candidate row and no alias map
  const research = (ps: Path[]) => ps.filter(p => /^Invented tie/.test(p.basis));

  // 1. A research key named in the export's alias map.
  {
    const run = connectionPaths([lp], new Map([[alias, finding(alias, lp.name, '2026-09-30', [tie('Invented Backer One', 'C', 'Invented tie one')])]]),
      net, team, [], at, undefined, undefined, { [alias]: lp.key });
    const rows = research(run.paths);
    check('W3 alias: a finding under a research key files its rows under the LP’s canonical key',
      rows.length === 1 && rows[0]!.lp === lp.key && run.rekeyed === 1 && !run.unresolved.length && rows.every(p => !pathProblems(p).length),
      'The same resolver as the checker (candidateKey) with the exported alias map.');
  }

  // 2. A merged person's old key, resolved by their unique confirmed identity to the firm's contact.
  {
    const run = connectionPaths([firm], new Map([[mergedKey, finding(mergedKey, contact.name, '2026-09-30', [tie('Invented Backer Two', 'C', 'Invented tie two')])]]),
      net, team, [], at);
    const rows = research(run.paths);
    const own = rows.filter(p => p.lp === contact.key), routed = rows.filter(p => p.lp === firm.key);
    check('W3 alias: a merged person’s ties reach the firm LP as contact routes',
      own.length === 1 && routed.length === 1 && routed[0]!.viaContact?.key === contact.key && routed[0]!.viaContact?.role === 'Partner'
        && !rows.some(p => p.lp === mergedKey) && rows.every(p => !pathProblems(p).length),
      'The person’s row is the contact endpoint; the firm’s row carries viaContact, as the import and network build expect.');
  }

  // 3. Unresolvable keys: a research key goes to the counted bucket; an entity UUID stays a non-LP endpoint.
  {
    const lost = 'invented-research-nobody', stranger = uuid(91);
    const run = connectionPaths([lp], new Map([
      [lost, finding(lost, 'Invented Nobody', '2026-09-30', [tie('Invented Backer Three', 'C', 'Invented tie three'), tie('Invented Backer Four', 'D', 'Invented tie four')])],
      [stranger, finding(stranger, 'Invented Stranger', '2026-09-30', [tie('Invented Backer Five', 'C', 'Invented tie five')])],
    ]), net, team, [], at);
    check('W3 alias: rows under a key nothing resolves are counted apart, never dropped or imported',
      research(run.unresolved).length === 2 && run.unresolved.every(p => p.lp === lost)
        && !run.paths.some(p => p.lp === lost) && run.paths.every(p => !pathProblems(p).length)
        && research(run.paths).some(p => p.lp === stranger),
      'An entity outside the LP set keeps its connector rows for the network build; a bare research key cannot be imported.');
  }

  // 4. Two findings for one LP: the same record merges to its best tier; different evidence stays.
  {
    const own = finding(lp.key, lp.name, '2026-09-20', [tie('Invented Backer Six', 'D', 'Invented tie six'), tie('Invented Backer Seven', 'C', 'Invented tie seven')]);
    const dup = finding(alias, lp.name, '2026-09-25', [tie('Invented Backer Six', 'C', 'Invented tie six'), tie('Invented Backer Seven', 'C', 'Invented tie seven, again')]);
    for (const order of [[own, dup], [dup, own]]) {
      const run = connectionPaths([lp], new Map(order.map(f => [f.key, f])), net, team, [], at, undefined, undefined, { [alias]: lp.key });
      const six = research(run.paths).filter(p => p.other.name === 'Invented Backer Six');
      const seven = research(run.paths).filter(p => p.other.name === 'Invented Backer Seven');
      check(`W3 alias: duplicate rows for one LP and connector merge to the best tier (${order[0]!.key === lp.key ? 'own first' : 'alias first'})`,
        six.length === 1 && six[0]!.tier === 'C' && six[0]!.lp === lp.key && seven.length === 2 && seven.every(p => p.lp === lp.key),
        'One record twice keeps its better tier; a second, different basis is distinct evidence and is kept.');
    }
  }

  // 5. Random cases: every research tie lands once, under its LP or in the bucket, whatever the order.
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed);
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
    const lps = [lp, person(uuid(4), 'Invented Juniper Hale'), person(uuid(5), 'Invented Cedar Moss')];
    const cands = [...lps, firm];
    const aliases: Record<string, string> = {};
    const findings: Finding[] = [];
    const expect = new Map<string, { lp: string; tier: string }>(); // where a tie must land (a bucket key is marked), at what tier
    for (let i = 0; i < 2 + Math.floor(r() * 6); i++) {
      const target = pick([...lps, contact]);
      const how = pick(['own', 'alias', 'entityId', 'name', 'lost'] as const);
      const key = how === 'own' ? target.key : how === 'alias' ? `invented-alias-${seed}-${i}` : how === 'lost' ? `invented-lost-${seed}-${i}` : uuid(200 + i);
      if (how === 'alias') {
        if (target === contact) continue; // the export's alias map names LP units only
        aliases[key] = target.key;
      }
      if (findings.some(f => f.key === key)) continue;
      const ties = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, j) => {
        const shared = r() < 0.4; // the same record seen by two findings
        return tie(`Invented Backer ${shared ? 'Shared' : `${seed}-${i}-${j}`}`, pick(['C', 'D'] as const), `Invented tie ${shared ? 'shared' : `${seed}-${i}-${j}`}`);
      });
      const f = finding(key, how === 'lost' ? `Invented Lost ${seed} ${i}` : target.name, `2026-09-${String(10 + i).padStart(2, '0')}`, ties,
        how === 'entityId' ? { entityId: target.key } as Partial<Finding> : {});
      findings.push(f);
      for (const t of ties) {
        const where = how === 'lost' ? `bucket:${key}` : target.key;
        const id = `${where}|${t.basis}`;
        const prev = expect.get(id);
        expect.set(id, { lp: where, tier: prev && prev.tier < t.tier ? prev.tier : t.tier });
      }
    }
    const runs = [findings, [...findings].reverse()].map(fs =>
      connectionPaths(cands, new Map(fs.map(f => [f.key, f])), net, team, [], at, undefined, undefined, aliases));
    const direct = (ps: Path[]) => research(ps).filter(p => !p.viaContact);
    const placed = (run: (typeof runs)[number]) => {
      const out = new Map<string, string[]>();
      for (const p of direct(run.paths)) out.set(`${p.lp}|${p.basis}`, [...(out.get(`${p.lp}|${p.basis}`) ?? []), p.tier]);
      for (const p of research(run.unresolved)) out.set(`bucket:${p.lp}|${p.basis}`, [...(out.get(`bucket:${p.lp}|${p.basis}`) ?? []), p.tier]);
      return out;
    };
    const a = placed(runs[0]!), b = placed(runs[1]!);
    const landed = [...expect].every(([id, e]) => a.get(id)?.length === 1 && a.get(id)![0] === e.tier);
    const nothingElse = [...a.keys()].every(id => expect.has(id));
    const sameEitherOrder = JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    const valid = runs.every(run => run.paths.every(p => !pathProblems(p).length && (cands.some(c => c.key === p.lp) || p.lp === contact.key || isEntityKey(p.lp))));
    const routes = runs[0]!.paths.filter(p => p.viaContact?.key === contact.key && /^Invented tie/.test(p.basis));
    const contactTies = [...expect.values()].filter(e => e.lp === contact.key).length;
    check(`W3 alias property, seed ${seed}: each tie lands once under its LP at its best tier, or in the bucket`,
      landed && nothingElse && sameEitherOrder && valid && routes.length === contactTies && routes.every(p => p.lp === firm.key),
      'Conserved across own keys, exported aliases, entity IDs, unique names, unresolvable keys and finding order.');
  }

  // 6. The file run: findPaths reads the export's alias map beside the candidates.
  const scratch = await mkdtemp(join(tmpdir(), 'w3-alias-'));
  try {
    await mkdir(join(scratch, 'raw'), { recursive: true });
    await writeFile(join(scratch, 'candidates.jsonl'), JSON.stringify(lp) + '\n');
    await writeFile(join(scratch, 'entity-keys.json'), JSON.stringify({ [alias]: lp.key }) + '\n');
    await writeFile(join(scratch, 'raw', `${alias}.json`), JSON.stringify(finding(alias, lp.name, '2026-09-30', [tie('Invented Backer Eight', 'C', 'Invented tie eight')])));
    const run = await findPaths(scratch);
    check('W3 alias: the file run resolves research keys with entity-keys.json',
      research(run.paths).length === 1 && research(run.paths)[0]!.lp === lp.key && !run.unresolved.length,
      'No database: the alias map is the one the research export writes and the checker reads.');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
