import type { SeedContext } from './harness';

export async function closeProperties({ check, db }: SeedContext) {
  const disagreeing = await db.query<{ n: string }>(
    `select count(*)::text as n
       from close.pack_item p
       join close.cycle c on c.cycle_id = p.cycle_id
       join pipeline.exposure x on x.entity_id = p.entity_id and x.vehicle_id = c.vehicle_id
      where (p.status = 'countersigned') <> (x.track = 'hard')`,
  );
  check(
    'The pack and the exposure never disagree about a countersignature',
    Number(disagreeing[0]!.n) === 0,
    `${disagreeing[0]!.n} rows where the paperwork and the headline tell different stories`,
  );

}
