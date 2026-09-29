/** Invented scale fixture; every write is rolled back by the caller. */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../lib/db';
import type { Check, Db } from './properties/harness';
import type { ImportDuplicateReport } from '../lib/enrich/import-dupes';
import { recordDuplicateSeparations } from '../lib/enrich/duplicate-rules';
import { readSeparationGroups, violatesSeparationGroup } from '../modules/identity/separation-groups';

export async function separationScaleFixture(tx: Queryable) {
  const tag = randomUUID();
  const groups = Array.from({ length: 1400 }, (_, i) => ({
    name: `Invented Separation ${tag} Group ${i}`,
    entityIds: Array.from({ length: i === 0 ? 500 : 2 }, () => randomUUID()).sort(),
    reason: 'different external IDs from affinity',
  }));
  const unrelated = [randomUUID(), randomUUID()];
  const rows = [...groups.flatMap(g => g.entityIds.map(id => ({ id, name: g.name }))),
    ...unrelated.map(id => ({ id, name: `Invented Unreviewed ${tag}` }))];
  await tx.query(`insert into identity.entity(entity_id,entity_type,display_name)
    select id,'org',name from unnest($1::uuid[],$2::text[]) t(id,name)`,
  [rows.map(r => r.id), rows.map(r => r.name)]);
  await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
    select 'affinity',id::text,id,'rule:invented-fixture' from unnest($1::uuid[]) id`, [rows.map(r => r.id)]);
  const report = (): ImportDuplicateReport => ({ merged: 0, merges: [], corrected: [], ambiguous: structuredClone(groups) });
  return { groups, unrelated, report };
}

export function countSeparationWrites(tx: Queryable) {
  let inserts = 0;
  const wrapped: Queryable = {
    query: async <T>(sql: string, params?: unknown[]) => {
      if (/insert\s+into\s+identity\.match_assertion/i.test(sql)) inserts++;
      return tx.query<T>(sql, params);
    },
    one: async <T>(sql: string, params?: unknown[]) => tx.one<T>(sql, params),
    exec: sql => tx.exec(sql),
  };
  return { tx: wrapped, inserts: () => inserts };
}

export async function separationBulkProperties(check: Check, db: Db) {
  await db.transaction(async tx => {
    await tx.exec('savepoint separation_scale_fixture');
    try {
      const fixture = await separationScaleFixture(tx);
      const counted = countSeparationWrites(tx);
      const before = Number((await tx.one<{ n: string }>('select count(*) n from identity.match_assertion'))!.n);
      const report = fixture.report();
      // Overlapping review outputs may repeat a group; one pass still writes each assertion once.
      report.ambiguous.push(structuredClone(report.ambiguous[0]!));
      const started = performance.now();
      await recordDuplicateSeparations(counted.tx, 'invented-scale-property', report);
      const elapsed = performance.now() - started;
      const after = Number((await tx.one<{ n: string }>('select count(*) n from identity.match_assertion'))!.n);
      check('SEPARATION SCALE 500 members and 1400 groups use linear storage and one insert',
        after - before === 499 + 1399 && counted.inserts() === 1 && elapsed < 120_000,
        `${after - before} assertions; ${counted.inserts()} insert statement; ${(elapsed / 1000).toFixed(2)}s.`);
      const repeated = fixture.report();
      await recordDuplicateSeparations(counted.tx, 'invented-scale-property', repeated);
      const retry = Number((await tx.one<{ n: string }>('select count(*) n from identity.match_assertion'))!.n);
      check('SEPARATION SCALE retry skips already asserted candidate pairs',
        retry === after && counted.inserts() === 1 && !Object.values(repeated.rules ?? {}).some(n => n > 0),
        'No second INSERT and no newly reported rule applications.');
      const unrelated = await tx.one<{ n: string }>(`select count(*) n from identity.match_assertion
        where merged_entity=any($1::uuid[]) or canonical_entity=any($1::uuid[])`, [fixture.unrelated]);
      check('SEPARATION SCALE same-name identities outside candidates remain untouched', Number(unrelated!.n) === 0,
        'The unreviewed same-name pair has different external IDs but no candidate assertion.');
      const [anchor, a, b] = fixture.groups[0]!.entityIds;
      const subset = fixture.report();
      subset.ambiguous = [{ ...fixture.groups[0]!, entityIds: [a!, b!] }];
      await recordDuplicateSeparations(counted.tx, 'invented-scale-property', subset);
      check('SEPARATION SCALE retry of a non-anchor subset reuses compact assertions',
        counted.inserts() === 1 && !Object.values(subset.rules ?? {}).some(n => n > 0),
        'A candidate subset cannot expand a recorded compact group back into pairwise rows.');
      const protectedGroups = await readSeparationGroups(tx);
      check('SEPARATION SCALE compact assertions protect non-anchor members',
        violatesSeparationGroup([a!, b!], protectedGroups) && !violatesSeparationGroup([anchor!], protectedGroups),
        'Two non-anchor members violate the all-different constraint; one member does not.');
      await tx.query('update identity.entity set merged_into=$2 where entity_id=$1', [a, fixture.unrelated[0]]);
      check('SEPARATION SCALE compact constraints follow canonical aliases',
        violatesSeparationGroup([fixture.unrelated[0]!, b!], await readSeparationGroups(tx)),
        'The component containing an aliased member remains different from every other group member.');
    } finally {
      await tx.exec('rollback to savepoint separation_scale_fixture; release savepoint separation_scale_fixture');
    }
  });
}
