import type { Check } from './harness';
import { openTestDb } from './database';
import { migrate } from '../../lib/db/migrate';

export async function perf4Properties(check: Check) {
  const db = await openTestDb('memory://');
  try {
    await migrate(db);
    // Original recursive definition is the oracle, including corrupt cycles,
    // unknown IDs, retired roots and merges undone after a previous read.
    await db.exec(`insert into identity.entity(entity_id,entity_type,display_name)
      select md5('perf4-property-' || n)::uuid,'person','Invented identity ' || n
      from generate_series(1,12) n;
      update identity.entity set merged_into=md5('perf4-property-1')::uuid
        where entity_id=md5('perf4-property-2')::uuid;
      update identity.entity set merged_into=md5('perf4-property-2')::uuid
        where entity_id=md5('perf4-property-3')::uuid;
      update identity.entity set merged_into=md5('perf4-property-5')::uuid
        where entity_id=md5('perf4-property-4')::uuid;
      update identity.entity set merged_into=md5('perf4-property-4')::uuid
        where entity_id=md5('perf4-property-5')::uuid;
      update identity.entity set retired_at=now() where entity_id=md5('perf4-property-6')::uuid;`);
    const compare = () => db.one<{ equal: boolean }>(`with inputs as (
      select entity_id id from identity.entity union all select null::uuid
      union all select md5('missing')::uuid
    ) select bool_and(identity.canonical_entity_id(id) is not distinct from (
      with recursive chain as (
        select entity_id,merged_into,array[entity_id] seen from identity.entity where entity_id=id
        union all select e.entity_id,e.merged_into,c.seen || e.entity_id
        from chain c join identity.entity e on e.entity_id=c.merged_into
        where not e.entity_id=any(c.seen)
      ) select entity_id from chain where merged_into is null limit 1
    )) equal from inputs`);
    check('PERF4 canonical lookup preserves recursive resolution', (await compare())?.equal === true,
      'Roots, multi-hop aliases, cycles, missing IDs, null and retired entities equal the original recursive CTE.');
    await db.exec(`update identity.entity set merged_into=null where entity_id=md5('perf4-property-2')::uuid`);
    check('PERF4 canonical lookup observes an undone merge immediately', (await compare())?.equal === true,
      'Resolution is STABLE within a statement, never cached across database changes.');
  } finally { await db.close(); }
}
