/** Bulk import semantic regressions. All identities and pages are invented. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withDb } from '../../lib/db';
import { migrate } from '../../lib/db/migrate';
import { importFindings } from '../../lib/enrich/import';
import { resolveConnectionPeople } from '../../lib/enrich/connection-people';
import { connectionPersonKey, type Path } from '../../lib/enrich/connect';
import type { Finding } from '../../lib/enrich/schema';
import { openTestDb } from './database';
import type { Check } from './harness';

export async function findingsPerfProperties(check: Check) {
  const dir = await mkdtemp(join(tmpdir(), 'findings-perf-props-'));
  const db = await openTestDb(join(dir, 'db'));
  try {
    await migrate(db);
    await mkdir(join(dir, 'raw'));
    const lp = '00000000-0000-4000-8000-000000000001';
    const alias = '00000000-0000-4000-8000-000000000002';
    const actor = randomUUID();
    await db.query(`insert into platform.app_user (id,handle,name,initials,role,email) values ($1,'bulk-fixture','Bulk Fixture','BF','team','fixture@example.org')`, [actor]);
    await db.query(`insert into identity.entity (entity_id,entity_type,display_name) values ($1,'person','Invented Bulk Person'),($2,'person','Invented Bulk Alias')`, [lp, alias]);
    await db.query('update identity.entity set merged_into=$1 where entity_id=$2', [lp, alias]);
    const url = 'https://example.org/bulk-fixture';
    const doc = `pub:${createHash('sha1').update(url).digest('hex').slice(0, 16)}`;
    await db.query(`insert into research.source_doc (doc_id,title,kind,origin,as_of,strength,supports,body)
      values ($1,'Original title','public:primary',$2,'2026-01-01','weak','Original supports','Original body')`, [doc, url]);
    await db.query(`insert into research.claim (entity_id,field,value,source,as_of,confidence,last_verified_by)
      select $1::uuid,'public.interest','Retained fact',$2,'2026-01-01'::date,'high'::research.confidence,$3::uuid from generate_series(1,2)`, [lp, doc, actor]);
    const finding: Finding = { key: lp, name: 'Invented Bulk Person', researched: { at: '2026-09-27', by: 'fixture', workflow: 'W1', version: '1' },
      identity: { match: 'confirmed', basis: 'Invented fixture' }, profile: { summary: 'First profile', interests: ['One', 'Two'], investorType: 'unknown' },
      facts: [{ field: 'interest', value: 'Retained fact', confidence: 'medium', source: { url, kind: 'filing', title: 'First title', published: '2026-02-03' } },
        ...Array.from({ length: 505 }, (_, i) => ({ field: 'interest' as const, value: `Invented research observation ${i}`, confidence: 'low' as const,
          source: { url, kind: 'primary' as const, title: 'Later title', published: '2026-09-27' } })),
        { field: 'spv_deals', value: '3', quote: 'Three invented co-investments.', confidence: 'high', source: { url, kind: 'primary' } }] };
    // Duplicates straddle the batch boundary and alias files; the first occurrence wins.
    finding.facts.push({ ...finding.facts[1]!, confidence: 'high' });
    await writeFile(join(dir, 'raw', `${lp}.json`), JSON.stringify(finding));
    await writeFile(join(dir, 'raw', `${alias}.json`), JSON.stringify({ ...finding, key: alias, profile: { ...finding.profile, summary: 'Alias profile' } }));
    const person = { key: connectionPersonKey('Invented Bulk Connector', url), name: 'Invented Bulk Connector', source: url };
    const paths: Path[] = ['D', 'B', 'C', 'B'].map((tier, i) => ({ lp, other: { type: 'backer', key: person.key, name: person.name, person },
      kind: 'other', tier: tier as Path['tier'], basis: `Invented path ${i}`, source: url }));
    await writeFile(join(dir, 'connections.jsonl'), paths.map(p => JSON.stringify(p)).join('\n'));
    const first = await withDb(db, () => importFindings(null, dir));
    const retained = await db.one<{ n: number }>(`select count(*)::int n from research.claim where last_verified_by=$1`, [actor]);
    const inserted = await db.one<{ n: number; confidence: string }>(`select count(*)::int n,min(confidence::text) confidence from research.claim where value='Invented research observation 0'`);
    check('FINDINGS bulk claims preserve verified duplicates and first unverified occurrence across alias files and batches',
      first.claims === 506 && first.keptVerified === 2 && retained?.n === 2 && inserted?.n === 1 && inserted.confidence === 'low',
      `claims=${first.claims}, retained=${retained?.n}, duplicate count=${inserted?.n}, confidence=${inserted?.confidence}`);
    const source = await db.one<{ title: string; strength: string; supports: string; body: string; as_of: string }>(
      'select title,strength::text,supports,body,as_of::text from research.source_doc where doc_id=$1', [doc]);
    check('FINDINGS source upsert preserves first source occurrence and existing immutable page content',
      source?.title === 'First title' && source.strength === 'strong' && source.as_of === '2026-02-03' && source.supports === 'Original supports' && source.body === 'Original body',
      'Later facts sharing the URL cannot overwrite the first title, date or strength.');
    const profiles = await db.query<{ body: string; tags: string[] }>(`select body,tags from research.note where kind='public_profile' order by body`);
    const candidate = await db.one<{ data: { paths: Path[] } }>(`select data from research.note where kind='connection_candidates'`);
    check('FINDINGS notes retain both alias profiles, array tags, and stable order within path tiers',
      profiles.length === 2 && profiles.every(p => p.tags.join(',') === 'One,Two') && candidate?.data.paths.map(p => p.basis).join(',') === 'Invented path 1,Invented path 3,Invented path 2,Invented path 0',
      'Batching does not collapse same-entity notes or reorder equal-tier paths.');
    const again = await withDb(db, () => importFindings(null, dir));
    const spv = await db.one<{ n: number; deals: number }>(`select count(*)::int n,max(min_deals) deals from strategy.spv_evidence where kind='research'`);
    check('FINDINGS retry recreates exactly one SPV evidence row per new unique claim',
      again.claims === 506 && again.spvFacts === 1 && spv?.n === 1 && spv.deals === 3,
      'Claim cascade and evidence provenance remain intact across replacement.');
    const connectorPaths: Path[] = Array.from({ length: 505 }, (_, i) => {
      const name = `Invented Batch Connector ${i}`;
      const person = { key: connectionPersonKey(name, url), name, source: url };
      return { lp, other: { type: 'backer', name, key: person.key, person }, kind: 'other', tier: 'C', basis: 'Invented tie', source: url };
    });
    const conflictingName = 'Invented Opposite Type';
    const conflicting = { key: connectionPersonKey(conflictingName, url), name: conflictingName, source: url };
    await db.query(`insert into identity.entity (entity_type,display_name) values ('org',$1)`, [conflictingName]);
    const conflictPath: Path = { lp, other: { type: 'backer', key: conflicting.key, name: conflictingName, person: conflicting },
      kind: 'other', tier: 'C', basis: 'Invented type conflict', source: url };
    const skips: number[] = [];
    const resolved = await db.transaction(tx => resolveConnectionPeople(tx, [...connectorPaths, conflictPath], i => skips.push(i)));
    const retry = await db.transaction(tx => resolveConnectionPeople(tx, connectorPaths));
    const excluded = await db.one<{ n: number }>('select count(*)::int n from identity.entity where entity_id=$1', [conflicting.key]);
    check('FINDINGS connector batches preserve sourced identities and refuse opposite entity types before writes',
      resolved.length === 505 && skips.join(',') === '505' && excluded?.n === 0 && JSON.stringify(resolved) === JSON.stringify(retry),
      '505 descriptors cross the write batch boundary; rejected-only nodes are absent and repeated resolution is stable.');
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
}
