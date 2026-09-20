import type { Db } from './db';
import { config } from '@/config/deployment';

/**
 * L9 seed: factors for the Neurotech universe, deliberately incomplete in two places.
 *
 * Northwood and Okonjo are missing a dimension each, so the ranking has to show what an
 * unscored target looks like — which is the case the rubric is most likely to be wrong about.
 */
export async function seedScoring(db: Db): Promise<{ factors: number }> {
  const existing = await db.one<{ n: string }>('select count(*)::text as n from scoring.factor');
  if (existing && Number(existing.n) > 0) return { factors: 0 };

  const users = await db.query<{ id: string; handle: string }>('select id, handle from platform.app_user');
  const entities = await db.query<{ entity_id: string; display_name: string }>(
    'select entity_id, display_name from identity.entity',
  );
  const vehicles = await db.query<{ id: string; slug: string }>('select id, slug from platform.vehicle');
  const u = (h: string) => users.find((x) => x.handle === h)!.id;
  const e = (n: string) => entities.find((x) => x.display_name === n)!.entity_id;
  const neurotech = vehicles.find((x) => x.slug === 'neurotech')!.id;

  const w = config.scoring.weights;

  const factors: Array<{
    entity: string; dimension: string; value: number; basis: string;
    source?: string; as_of: string; by: string;
  }> = [
    // Cedar Trust — the one already countersigned. The rubric should agree.
    { entity: 'Cedar Trust', dimension: 'capacity', value: 0.85, basis: 'Endowment at this size writes $4M without a committee exception.', as_of: '2026-08-20', by: 'mara' },
    { entity: 'Cedar Trust', dimension: 'affinity', value: 0.75, basis: 'Neuro sits inside their life-sciences allocation; the thesis landed in the first meeting.', as_of: '2026-08-20', by: 'mara' },
    { entity: 'Cedar Trust', dimension: 'propensity', value: 0.8, basis: 'Four emerging-manager commitments in three years, two of them first-time funds.', as_of: '2026-08-11', by: 'mara' },
    { entity: 'Cedar Trust', dimension: 'time_to_decision', value: 0.9, basis: 'Indication to countersignature took sixteen days.', as_of: '2026-09-18', by: 'tomas' },

    // Roos Foundation — strong on affinity, weak on instrument fit.
    { entity: 'Roos Foundation', dimension: 'capacity', value: 0.55, basis: '$2–5M band, from a forwarded excerpt rather than a statement to us.', source: 'S03', as_of: '2026-08-30', by: 'ines' },
    { entity: 'Roos Foundation', dimension: 'affinity', value: 0.9, basis: 'Forty-seven grants concentrated in exactly our field.', source: 'S02', as_of: '2026-09-14', by: 'ines' },
    { entity: 'Roos Foundation', dimension: 'propensity', value: 0.25, basis: 'No LP positions at all in the seven-year export. A PRI is plausible; a fund commitment is not evidenced.', source: 'S02', as_of: '2026-09-14', by: 'ines' },
    { entity: 'Roos Foundation', dimension: 'time_to_decision', value: 0.35, basis: 'Rolling cycle, sole trustee, and an unresolved §4944(c) question from 2024.', source: 'S10', as_of: '2026-09-12', by: 'tomas' },

    // Whitcomb — already hard on an SPV, soft on the fund.
    { entity: 'Whitcomb Capital', dimension: 'capacity', value: 0.6, basis: '$8M budget stated by them, unconfirmed since August.', as_of: '2026-08-01', by: 'juan' },
    { entity: 'Whitcomb Capital', dimension: 'affinity', value: 0.7, basis: 'Took the Cortex SPV, which is the same thesis in a smaller wrapper.', as_of: '2026-09-09', by: 'juan' },
    { entity: 'Whitcomb Capital', dimension: 'propensity', value: 0.85, basis: 'Wired the SPV nineteen days after allocation. They do what they say.', as_of: '2026-09-09', by: 'juan' },
    { entity: 'Whitcomb Capital', dimension: 'time_to_decision', value: 0.8, basis: 'Thirty days invite to wire on the SPV.', as_of: '2026-09-09', by: 'juan' },

    // Northwood — missing propensity on purpose. Nobody has looked it up.
    { entity: 'Northwood Capital', dimension: 'capacity', value: 0.8, basis: '$1.4B across nine families — but the only source is a 2021 CSV nobody can vouch for.', source: 'S11', as_of: '2021-06-01', by: 'mara' },
    { entity: 'Northwood Capital', dimension: 'affinity', value: 0.6, basis: 'Emerging-manager programme is active; neuro is not a stated focus.', as_of: '2026-09-14', by: 'juan' },
    { entity: 'Northwood Capital', dimension: 'time_to_decision', value: 0.5, basis: 'Asked for a DDQ pack within a week of meeting, which is fast for a multi-family office.', as_of: '2026-09-08', by: 'juan' },

    // Okonjo — missing two. Three weeks of silence is not a factor value.
    { entity: 'Okonjo Family Office', dimension: 'capacity', value: 0.5, basis: '$5M budget inferred from their last three commitments, not stated.', as_of: '2026-07-15', by: 'juan' },
    { entity: 'Okonjo Family Office', dimension: 'affinity', value: 0.55, basis: 'Neuro interest dates from a 2024 panel; nothing since.', source: 'S07', as_of: '2024-11-05', by: 'ines' },

    // Brenner and Vantage — already in, scored for comparison.
    { entity: 'Brenner Endowment', dimension: 'capacity', value: 0.95, basis: '$30M allocation letter, March 2026.', as_of: '2026-03-01', by: 'mara' },
    { entity: 'Brenner Endowment', dimension: 'affinity', value: 0.8, basis: 'Anchored the first close on the thesis alone.', as_of: '2026-06-30', by: 'juan' },
    { entity: 'Brenner Endowment', dimension: 'propensity', value: 0.9, basis: 'Anchor investor. They commit.', as_of: '2026-06-30', by: 'juan' },
    { entity: 'Brenner Endowment', dimension: 'time_to_decision', value: 0.85, basis: 'Signed inside six weeks of first contact.', as_of: '2026-06-30', by: 'juan' },
  ];

  await db.transaction(async (tx) => {
    await tx.query(
      `insert into scoring.weights (label, capacity, affinity, propensity, time_to_decision, active, created_by)
       values ('From config/deployment.ts', $1, $2, $3, $4, true, $5)`,
      [w.capacity, w.affinity, w.propensity, w.timeToDecision, u('juan')],
    );
    for (const f of factors) {
      await tx.query(
        `insert into scoring.factor (entity_id, vehicle_id, dimension, value, basis, source, as_of, recorded_by)
         values ($1,$2,$3::scoring.dimension,$4,$5,$6,$7::date,$8)`,
        [e(f.entity), neurotech, f.dimension, f.value, f.basis, f.source ?? null, f.as_of, u(f.by)],
      );
    }
  });

  return { factors: factors.length };
}
