import { coalescePage } from '@/lib/page-render';
import { getDb } from '@/lib/db';
import { Page } from '@/components/shell/Page';

export const dynamic = 'force-dynamic';

/** Small, server-rendered probe inventory. No names or cache payloads leave the DB. */
async function Performance() {
  const db = await getDb();
  const rows = await db.query<{ slug: string; target_id: string; pursuit_id: string; n: number }>(`
    with counts as materialized (
      select c.target_id, c.vehicle_kind,
        jsonb_array_length(coalesce(c.search->'structural'->'candidates', c.search->'routes', '[]'::jsonb)) as n
      from network.route_cache c
    ), ranked as (
      select v.slug, c.target_id, p.pursuit_id, c.n,
        row_number() over (partition by v.id order by c.n desc, c.target_id) as most,
        row_number() over (partition by v.id, (c.n = 0) order by c.target_id) as zero
      from counts c join strategy.active_pursuit p on p.entity_id = c.target_id
      join platform.vehicle v on v.id = p.vehicle_id and v.kind::text = c.vehicle_kind
    ) select slug, target_id, pursuit_id, n from ranked where most = 1 or (n = 0 and zero = 1)
      order by slug, n desc limit 32`);
  const org = await db.one<{ entity_id: string }>(`select entity_id from identity.entity
    where entity_type <> 'person' and merged_into is null and retired_at is null
    order by entity_id limit 1`);
  return <Page crumbs={[{ label: 'Developer' }, { label: 'Performance probes' }]}>
    <h1>Performance probes</h1>
    <p>Largest and empty stored route searches per vehicle. Missing cache entries are unknown, not empty. Counts describe the stored snapshot, before live restrictions.</p>
    {org && <p><a data-probe="org" href={`/orgs/${org.entity_id}`}>Organization page</a></p>}
    <ul>{rows.map(r => <li key={`${r.slug}:${r.target_id}`}>
      <a data-probe={r.n === 0 ? 'routes-empty' : 'routes-most'} data-count={r.n} href={`/${r.slug}/routes?target=${r.target_id}`}>{r.slug}: {r.n} stored paths</a>{' · '}
      <a data-probe="lp" href={`/${r.slug}/pipeline/${r.pursuit_id}`}>LP page</a>{' · '}
      <a href={`/orgs/${r.target_id}`}>Entity page</a>
    </li>)}</ul>
  </Page>;
}

export default coalescePage('/dev/performance', Performance);
