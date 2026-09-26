import type { SeedContext } from './harness';

export async function strategyProperties({ check, db }: SeedContext) {
  const { RUNGS } = await import('../../modules/strategy');
  const pursuits = await db.query<{ pursuit_id: string; rungs: string[] }>(
    `select p.pursuit_id, array_agg(l.rung::text order by l.occurred_at) as rungs
       from strategy.pursuit p join strategy.ladder_event l on l.pursuit_id = p.pursuit_id
      group by p.pursuit_id`,
  );
  const gapped = pursuits.filter((p) => {
    const idxs = p.rungs.map((r) => RUNGS.indexOf(r as (typeof RUNGS)[number])).sort((a, b) => a - b);
    return idxs.some((v, i) => v !== i);
  });
  check(
    'The consent ladder has no gaps: recorded rungs are always a prefix',
    gapped.length === 0,
    `${gapped.length} pursuits with a skipped rung`,
  );

  const softHard = await db.query<{ n: string }>(
    `select count(*)::text as n from strategy.ladder_event
      where rung = 'cash_received' and pursuit_id not in (
        select pursuit_id from strategy.ladder_event where rung = 'commitment_accepted')`,
  );
  check(
    'No cash is recorded without an accepted commitment beneath it',
    Number(softHard[0]!.n) === 0,
    `${softHard[0]!.n} violations`,
  );

}
